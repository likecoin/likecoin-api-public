import crypto from 'crypto';
import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import { getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import {
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  getNftBookInfo,
} from '../../../util/api/likernft/book';
import { db, likeNFTBookCartCollection, likeNFTBookCollection } from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import {
  LIKER_LAND_HOSTNAME,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { sendNFTBookGiftSentEmail, sendNFTBookOutOfStockEmail, sendNFTBookShippedEmail } from '../../../util/ses';
import {
  LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES,
  SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD,
} from '../../../../config/config';
import {
  handleNewStripeCheckout,
  claimNFTBook,
  createNewNFTBookPayment,
  processNFTBookPurchase,
  sendNFTBookClaimedEmailNotification,
  sendNFTBookPurchaseEmail,
  updateNFTBookPostDeliveryData,
} from '../../../util/api/likernft/book/purchase';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../util/slack';
import { subscribeEmailToLikerLandSubstack } from '../../../util/substack';
import { claimNFTBookCart, handleNewCartStripeCheckout } from '../../../util/api/likernft/book/cart';
import { createAirtableBookSalesRecordFromFreePurchase } from '../../../util/airtable';
import { getReaderSegmentNameFromAuthorWallet, upsertCrispProfile } from '../../../util/crisp';
import logPixelEvents from '../../../util/fbq';

const router = Router();

router.get(
  '/cart/:cartId/status',
  async (req, res, next) => {
    try {
      const { cartId } = req.params;
      const doc = await likeNFTBookCartCollection.doc(cartId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      res.json(filterBookPurchaseData(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/cart/:cartId/claim',
  async (req, res, next) => {
    try {
      const { cartId } = req.params;
      const { token } = req.query;
      const { wallet, message, loginMethod } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      const {
        email,
        classIds,
        collectionIds,
        newClaimedNFTs,
        allItemsAutoClaimed,
        errors,
      } = await claimNFTBookCart(
        cartId,
        {
          message,
          wallet,
          token: token as string,
          loginMethod,
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookCartClaimed',
        cartId,
        wallet,
        email,
        buyerMessage: message,
        loginMethod,
        allItemsAutoClaimed,
      });
      res.json({
        classIds,
        collectionIds,
        newClaimedNFTs,
        allItemsAutoClaimed,
        errors,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/cart/new', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { from } = req.query;
    const {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      email,
      utmCampaign,
      utmSource,
      utmMedium,
      referrer: inputReferrer,
      items = [],
      coupon,
      giftInfo,
    } = req.body;

    if (!items?.length) {
      throw new ValidationError('REQUIRE_ITEMS');
    }

    if (giftInfo) {
      if (!giftInfo.toEmail) throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
      if (!W3C_EMAIL_REGEX.test(giftInfo.toEmail)) throw new ValidationError('INVALID_GIFT_TO_EMAIL');
    }

    const referrer = inputReferrer;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const {
      url,
      paymentId,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewCartStripeCheckout(items, {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      from: from as string,
      giftInfo,
      likeWallet: req.user?.wallet,
      email,
      coupon,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      referrer,
      userAgent,
      clientIp,
    });
    res.json({ paymentId, url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTCartPurchaseNew',
        type: 'stripe',
        paymentId,
        price: priceInDecimal / 100,
        originalPrice: originalPriceInDecimal / 100,
        customPriceDiff: customPriceDiffInDecimal && customPriceDiffInDecimal / 100,
        sessionId,
        channel: from,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
        isGift: !!giftInfo,
      });

      await logPixelEvents('InitiateCheckout', {
        email,
        items: items.map((item) => ({
          productId: item.classId || item.collectionId,
          priceIndex: item.priceIndex,
          quantity: item.quantity,
        })),
        userAgent,
        clientIp,
        value: priceInDecimal / 100,
        currency: 'USD',
        paymentId,
        referrer,
        fbClickId,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get(['/:classId/new', '/class/:classId/new'], jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  const { classId } = req.params;
  try {
    const {
      from,
      ga_client_id: gaClientId = '',
      ga_session_id: gaSessionId = '',
      gclid: gadClickId = '',
      gad_source: gadSource = '',
      price_index: priceIndexString = undefined,
      utm_campaign: utmCampaign,
      utm_source: utmSource,
      utm_medium: utmMedium,
      custom_price: inputCustomPriceInDecimal,
      quantity: inputQuantity,
      referrer: inputReferrer,
      coupon,
      fbclid: fbClickId = '',
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;
    const quantity = parseInt(inputQuantity as string, 10) || 1;
    const httpMethod = 'GET';
    const referrer = (inputReferrer || req.get('Referrer')) as string;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const customPriceInDecimal = parseInt(inputCustomPriceInDecimal as string, 10) || undefined;
    const {
      url,
      paymentId,
      priceName,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewStripeCheckout(classId, priceIndex, {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      gadClickId: gadClickId as string,
      gadSource: gadSource as string,
      fbClickId: fbClickId as string,
      coupon: coupon as string,
      customPriceInDecimal,
      quantity,
      likeWallet: req.user?.wallet,
      from: from as string,
      clientIp,
      referrer,
      utm: {
        campaign: utmCampaign as string,
        source: utmSource as string,
        medium: utmMedium as string,
      },
      httpMethod,
    });
    res.redirect(url);

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        classId,
        priceName,
        priceIndex,
        price: priceInDecimal / 100,
        originalPrice: originalPriceInDecimal / 100,
        customPriceDiff: customPriceDiffInDecimal && customPriceDiffInDecimal / 100,
        coupon,
        sessionId,
        isGift: false,
        channel: from,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
        httpMethod,
      });
    }

    await logPixelEvents('InitiateCheckout', {
      items: [{ productId: classId, priceIndex, quantity }],
      userAgent,
      clientIp,
      value: priceInDecimal / 100,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId: fbClickId as string,
    });
  } catch (err) {
    if ((err as Error).message === 'OUT_OF_STOCK') {
      // eslint-disable-next-line no-console
      console.error(`OUT_OF_STOCK: ${classId}`);
      res.redirect(`https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}`);
    } else {
      next(err);
    }
  }
});

router.post(['/:classId/new', '/class/:classId/new'], jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      from,
      price_index: priceIndexString = undefined,
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;
    const {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      coupon,
      email,
      giftInfo,
      utmCampaign,
      utmSource,
      utmMedium,
      referrer: inputReferrer,
      customPriceInDecimal,
    } = req.body;
    let {
      quantity = 1,
    } = req.body;
    quantity = parseInt(quantity, 10) || 1;

    if (giftInfo) {
      if (!giftInfo.toEmail) throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
      if (!W3C_EMAIL_REGEX.test(giftInfo.toEmail)) throw new ValidationError('INVALID_GIFT_TO_EMAIL');
    }

    const httpMethod = 'POST';
    const referrer = inputReferrer;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const {
      url,
      paymentId,
      priceName,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewStripeCheckout(classId, priceIndex, {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      coupon,
      customPriceInDecimal: parseInt(customPriceInDecimal, 10) || undefined,
      likeWallet: req.user?.wallet,
      email,
      from: from as string,
      referrer,
      quantity,
      giftInfo,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      httpMethod,
      userAgent,
      clientIp,
    });
    res.json({ paymentId, url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        classId,
        priceName,
        priceIndex,
        price: priceInDecimal / 100,
        originalPrice: originalPriceInDecimal / 100,
        customPriceDiff: customPriceDiffInDecimal && customPriceDiffInDecimal / 100,
        coupon,
        sessionId,
        isGift: !!giftInfo,
        channel: from,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
        httpMethod,
      });
    }

    await logPixelEvents('InitiateCheckout', {
      email,
      items: [{ productId: classId, priceIndex, quantity }],
      userAgent,
      clientIp,
      value: priceInDecimal / 100,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  ['/:classId/new/free', '/class/:classId/new/free'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { from = '', price_index: priceIndexString = undefined } = req.query;
      const {
        email = '',
        wallet,
        message,
        gaClientId,
        gaSessionId,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer: inputReferrer,
        loginMethod,
      } = req.body;

      const referrer = inputReferrer;
      if (!email && !wallet) throw new ValidationError('REQUIRE_WALLET_OR_EMAIL');
      if (email) {
        const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
        if (isEmailInvalid) throw new ValidationError('INVALID_EMAIL');
      }

      const priceIndex = Number(priceIndexString) || 0;

      const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
      const [metadata, bookInfo] = (await Promise.all(promises)) as any;
      if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
      const {
        prices,
        notificationEmails,
        mustClaimToView = false,
        ownerWallet,
      } = bookInfo;
      if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const {
        priceInDecimal,
        stock,
        name: priceNameObj,
        isPhysicalOnly = false,
      } = prices[priceIndex];
      const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
      if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
      if (priceInDecimal > 0) throw new ValidationError('NOT_FREE_PRICE');

      const bookRef = likeNFTBookCollection.doc(classId);
      if (email) {
        const query = await bookRef.collection('transactions')
          .where('email', '==', email)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }
      if (wallet) {
        const query = await bookRef.collection('transactions')
          .where('wallet', '==', wallet)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }

      const paymentId = uuidv4();
      const claimToken = crypto.randomBytes(32).toString('hex');

      await createNewNFTBookPayment(classId, paymentId, {
        type: 'free',
        email,
        claimToken,
        priceInDecimal,
        originalPriceInDecimal: priceInDecimal,
        priceName,
        priceIndex,
        isPhysicalOnly,
        from: from as string,
      });

      const { listingData } = await processNFTBookPurchase({
        classId,
        email,
        phone: null,
        paymentId,
        shippingDetails: null,
        shippingCost: null,
      });
      const priceInfo = listingData.prices[priceIndex];

      // Remove after refactoring free purchase into purchase
      await createAirtableBookSalesRecordFromFreePurchase({
        classId,
        paymentId,
        priceIndex,
        from: from as string,
        email,
        wallet,
        utmSource,
        utmCampaign,
        utmMedium,
        referrer,
        gaClientId,
        gaSessionId,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTFreePurchaseNew',
        channel: from,
        paymentId,
        classId,
        priceIndex,
        email,
        wallet,
        utmSource,
        utmCampaign,
        utmMedium,
        referrer,
        gaClientId,
        gaSessionId,
        loginMethod,
      });

      if (email) {
        const segments = ['free book'];
        const readerSegment = getReaderSegmentNameFromAuthorWallet(ownerWallet);
        if (readerSegment) segments.push(readerSegment);
        try {
          await upsertCrispProfile(email, { segments });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
        }
      }

      const isOutOfStock = priceInfo.stock <= 0;
      const className = metadata?.name || classId;
      const notifications: Promise<any>[] = [
        sendNFTBookPurchaseEmail({
          isGift: false,
          giftInfo: null,
          email,
          notificationEmails,
          classId,
          bookName: className,
          priceName,
          paymentId,
          claimToken,
          amountTotal: 0,
          mustClaimToView,
          isPhysicalOnly,
          shippingDetails: null,
          from,
        }),
        sendNFTBookSalesSlackNotification({
          classId,
          bookName: className,
          paymentId,
          email,
          priceName,
          priceWithCurrency: 'FREE',
          method: 'free',
        }),
      ];
      if (stock <= SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD) {
        notifications.push(sendNFTBookOutOfStockSlackNotification({
          classId,
          className,
          priceName,
          priceIndex,
          notificationEmails,
          wallet: ownerWallet,
          stock: priceInfo.stock,
        }));
      }
      if (isOutOfStock) {
        notifications.push(sendNFTBookOutOfStockEmail({
          emails: notificationEmails,
          classId,
          bookName: className,
          priceName,
        // eslint-disable-next-line no-console
        }).catch((err) => console.error(err)));
      }
      await Promise.all(notifications);

      if (email) {
        try {
          await subscribeEmailToLikerLandSubstack(email);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(error);
        }
      }

      let nftId;
      if (wallet) {
        ({ nftId } = await claimNFTBook(
          classId,
          paymentId,
          {
            message,
            wallet,
            loginMethod,
            token: claimToken as string,
          },
          req,
        ));

        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTClaimed',
          paymentId,
          classId,
          wallet,
          email,
          buyerMessage: message,
        });

        await sendNFTBookClaimedEmailNotification(
          classId,
          nftId,
          paymentId,
          {
            message,
            wallet,
            email,
          },
        );
      }

      res.json({ claimed: !!wallet, nftId });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/:classId/status/:paymentId', '/class/:classId/status/:paymentId'],
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const doc = await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      res.json(filterBookPurchaseData(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  ['/:classId/claim/:paymentId', '/class/:classId/claim/:paymentId'],
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message, loginMethod } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      const { email, nftId } = await claimNFTBook(
        classId,
        paymentId,
        {
          message,
          wallet,
          token: token as string,
          loginMethod,
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimed',
        paymentId,
        classId,
        wallet,
        email,
        buyerMessage: message,
        loginMethod,
      });
      await sendNFTBookClaimedEmailNotification(
        classId,
        nftId,
        paymentId,
        {
          message,
          wallet,
          email,
        },
      );

      res.json({ nftId });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  ['/:classId/sent/:paymentId', '/class/:classId/sent/:paymentId'],
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { txHash } = req.body;
      let { quantity = 1 } = req.body;
      quantity = parseInt(quantity, 10) || 1;

      const { wallet } = req.user;

      const { email, isGift, giftInfo } = await db.runTransaction(async (t) => {
        const result = await updateNFTBookPostDeliveryData({
          classId,
          callerWallet: wallet,
          paymentId,
          quantity,
          txHash,
        }, t);
        return result;
      });

      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
        } = giftInfo;
        const classData = await getNFTClassDataById(classId).catch(() => null);
        const className = classData?.name || classId;
        if (email) {
          await sendNFTBookGiftSentEmail({
            fromEmail: email,
            fromName,
            toName,
            bookName: className,
            txHash,
          });
        }
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTSentUpdate',
        paymentId,
        classId,
        quantity,
        // TODO: parse nftId and wallet from txHash,
        txHash,
        isGift,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  ['/:classId/shipping/sent/:paymentId', '/class/:classId/shipping/sent/:paymentId'],
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { message } = req.body;
      // TODO: check tx content contains valid nft info and address
      const bookRef = likeNFTBookCollection.doc(classId);
      const bookDoc = await bookRef.get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        // TODO: check tx is sent by req.user.wallet
        throw new ValidationError('NOT_OWNER', 403);
      }
      const paymentDocRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);

      const { email } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          shippingStatus,
          isPhysicalOnly,
          hasShipping,
        } = docData;
        if (!hasShipping) {
          throw new ValidationError('PAYMENT_DOES_NOT_HAS_SHIPPING', 409);
        }
        if (shippingStatus === 'shipped') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        const updatePayload: any = {
          shippingStatus: 'shipped',
          shippingMessage: message,
        };
        if (isPhysicalOnly) updatePayload.status = 'completed';
        t.update(paymentDocRef, updatePayload);
        return docData;
      });

      if (email) {
        const classData = await getNFTClassDataById(classId).catch(() => null);
        const className = classData?.name || classId;
        await sendNFTBookShippedEmail({
          email,
          classId,
          bookName: className,
          message,
        });
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTShippingUpdate',
        paymentId,
        classId,
        shippingMessage: message,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/:classId/orders', '/class/:classId/orders'],
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const bookDoc = await likeNFTBookCollection.doc(classId).get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      const { wallet } = req.user;
      if (
        ownerWallet !== wallet
        && !moderatorWallets.includes(wallet)
        && !LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(wallet)
      ) {
        throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
      }
      const query = await likeNFTBookCollection.doc(classId).collection('transactions')
        .where('isPaid', '==', true)
        .get();
      const docDatas = query.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json({
        orders: docDatas.map((d) => filterBookPurchaseData(d)),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/:classId/messages', '/class/:classId/messages'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const bookDoc = await likeNFTBookCollection.doc(classId).get();
      if (!bookDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const query = await likeNFTBookCollection.doc(classId).collection('transactions')
        .where('status', '==', 'completed')
        .get();
      const data = query.docs.map((d) => {
        const {
          wallet,
          txHash,
          timestamp,
          message,
        } = d.data();
        return {
          wallet,
          txHash,
          timestamp: timestamp?.toMillis(),
          message,
        };
      });
      res.json({
        messages: data,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
