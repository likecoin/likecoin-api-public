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
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth } from '../../../middleware/jwt';
import { sendNFTBookGiftSentEmail, sendNFTBookShippedEmail } from '../../../util/ses';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../config/config';
import {
  handleNewStripeCheckout,
  claimNFTBook,
  execGrant,
  createNewNFTBookPayment,
  processNFTBookPurchase,
  sendNFTBookClaimedEmailNotification,
  sendNFTBookPurchaseEmail,
  updateNFTBookPostDeliveryData,
  getCouponDiscountRate,
} from '../../../util/api/likernft/book/purchase';
import { calculatePayment } from '../../../util/api/likernft/fiat';
import { checkTxGrantAndAmount } from '../../../util/api/likernft/purchase';
import { sendNFTBookSalesSlackNotification } from '../../../util/slack';
import { subscribeEmailToLikerLandSubstack } from '../../../util/substack';
import { claimNFTBookCart, handleNewCartStripeCheckout } from '../../../util/api/likernft/book/cart';

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
      const { wallet, message } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      const {
        email,
        classIds,
        collectionIds,
        newClaimedNFTs,
        errors,
      } = await claimNFTBookCart(
        cartId,
        {
          message,
          wallet,
          token: token as string,
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookCartClaimed',
        cartId,
        wallet,
        email,
        message,
      });
      res.json({
        classIds,
        collectionIds,
        newClaimedNFTs,
        errors,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/cart/new', async (req, res, next) => {
  try {
    const { from } = req.query;
    const {
      gaClientId,
      gaSessionId,
      email,
      utmCampaign,
      utmSource,
      utmMedium,
      referrer: inputReferrer,
      items = [],
    } = req.body;

    if (!items?.length) {
      throw new ValidationError('REQUIRE_ITEMS');
    }
    const referrer = inputReferrer || req.get('Referrer');
    const {
      url,
      paymentId,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewCartStripeCheckout(items, {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      from: from as string,
      email,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      referrer,
      userAgent: req.get('User-Agent'),
    });
    res.json({ url });

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
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get(['/:classId/new', '/class/:classId/new'], async (req, res, next) => {
  const { classId } = req.params;
  try {
    const {
      from,
      ga_client_id: gaClientId = '',
      ga_session_id: gaSessionId = '',
      price_index: priceIndexString = undefined,
      utm_campaign: utmCampaign,
      utm_source: utmSource,
      utm_medium: utmMedium,
      custom_price: inputCustomPriceInDecimal,
      quantity: inputQuantity,
      referrer: inputReferrer,
      coupon,
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;
    const quantity = parseInt(inputQuantity as string, 10) || 1;
    const httpMethod = 'GET';
    const referrer = inputReferrer || req.get('Referrer');
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
      coupon: coupon as string,
      customPriceInDecimal,
      quantity,
      from: from as string,
      userAgent: req.get('User-Agent'),
      referrer: referrer as string,
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

router.post(['/:classId/new', '/class/:classId/new'], async (req, res, next) => {
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

    if (giftInfo && !giftInfo.toEmail) {
      throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
    }

    const httpMethod = 'POST';
    const referrer = inputReferrer || req.get('Referrer');
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
      coupon,
      customPriceInDecimal: parseInt(customPriceInDecimal, 10) || undefined,
      from: from as string,
      referrer,
      quantity,
      giftInfo,
      email,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      httpMethod,
      userAgent: req.get('User-Agent'),
    });
    res.json({ url });

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
  } catch (err) {
    next(err);
  }
});

router.get(
  ['/:classId/price', '/class/:classId/price'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { price_index: priceIndexString, coupon } = req.query;
      const bookInfo = await getNftBookInfo(classId);

      const priceIndex = Number(priceIndexString);
      const { prices, canPayByLIKE, coupons } = bookInfo;
      if (prices.length <= priceIndex) {
        throw new ValidationError('PRICE_NOT_FOUND', 404);
      }

      let discount = 1;
      if (coupon) {
        discount = getCouponDiscountRate(coupons, coupon as string);
      }

      const { priceInDecimal } = prices[priceIndex];
      const price = priceInDecimal / 100;

      const {
        totalLIKEPricePrediscount,
        totalLIKEPrice,
        totalFiatPriceString,
        totalFiatPricePrediscountString,
      } = await calculatePayment([price], { discount });
      const payload = {
        LIKEPricePrediscount: canPayByLIKE ? totalLIKEPricePrediscount : null,
        LIKEPrice: canPayByLIKE ? totalLIKEPrice : null,
        fiatPrice: Number(totalFiatPriceString),
        fiatPricePrediscount: Number(totalFiatPricePrediscountString),
        fiatDiscount: discount,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

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
      } = req.body;

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

      await processNFTBookPurchase({
        classId,
        email,
        phone: null,
        paymentId,
        shippingDetails: null,
        shippingCost: null,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTFreePurchaseNew',
        channel: from,
        paymentId,
        classId,
        email,
      });

      const className = metadata?.name || classId;
      await Promise.all([
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
      ]);

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
          message,
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

router.post(
  ['/:classId/new/like', '/class/:classId/new/like'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { from: inputFrom = '', price_index: priceIndexString, coupon } = req.query;
      const {
        email,
        txHash: grantTxHash,
        giftInfo,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
      } = req.body;

      const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
      if (isEmailInvalid) throw new ValidationError('INVALID_EMAIL');

      const priceIndex = Number(priceIndexString);
      if (Number.isNaN(priceIndex)) throw new ValidationError('INVALID_PRICE_INDEX');

      if (giftInfo && !giftInfo.toEmail) {
        throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
      }

      const [metadata, bookInfo] = await Promise.all([
        getNFTClassDataById(classId).catch(() => null),
        getNftBookInfo(classId),
      ]);

      const {
        ownerWallet,
        prices,
        defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
        coupons,
      } = bookInfo;
      if (prices.length <= priceIndex) {
        throw new ValidationError('PRICE_NOT_FOUND', 404);
      }
      let from: string = inputFrom as string || '';
      if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
        from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
      }

      let discount = 1;
      if (coupon) {
        discount = getCouponDiscountRate(coupons, coupon as string);
      }
      const {
        priceInDecimal: originalPriceInDecimal,
        isPhysicalOnly = false,
        name: { en: priceNameEn },
      } = prices[priceIndex];
      const priceInDecimal = Math.round(originalPriceInDecimal * discount);
      const price = priceInDecimal / 100;

      const { totalLIKEPrice: LIKEPrice } = await calculatePayment([price]);

      const checkResult = await checkTxGrantAndAmount(grantTxHash, LIKEPrice);
      if (!checkResult) throw new ValidationError('SEND_GRANT_NOT_FOUND');
      const {
        granter: granterWallet,
        memo: message,
      } = checkResult;

      const paymentId = uuidv4();
      const claimToken = crypto.randomBytes(32).toString('hex');

      await createNewNFTBookPayment(classId, paymentId, {
        type: 'LIKE',
        email,
        claimToken,
        coupon: coupon as string,
        priceInDecimal,
        originalPriceInDecimal,
        priceName: priceNameEn,
        priceIndex,
        giftInfo,
        from,
        isPhysicalOnly,
      });
      const execGrantTxHash = await execGrant(granterWallet, ownerWallet, LIKEPrice, from);
      const { listingData } = await processNFTBookPurchase({
        classId,
        email,
        phone: null,
        paymentId,
        shippingDetails: null,
        shippingCost: null,
        execGrantTxHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'like',
        paymentId,
        classId,
        wallet: granterWallet,
        email,
        channel: from,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
      });
      const className = metadata?.name || classId;
      await sendNFTBookSalesSlackNotification({
        classId,
        bookName: className,
        paymentId,
        email,
        priceName: priceNameEn,
        priceWithCurrency: `${LIKEPrice} LIKE (${price} 'USD'})`,
        method: 'LIKE',
        from,
      });

      let claimed = false;
      let nftId;
      if (!giftInfo) {
        ({ nftId } = await claimNFTBook(classId, paymentId, {
          message,
          wallet: granterWallet,
          token: claimToken,
        }, req));
        claimed = true;
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTClaimed',
          paymentId,
          classId,
          wallet: granterWallet,
          email,
          message,
        });
      } else {
        const {
          notificationEmails = [],
          mustClaimToView = false,
        } = listingData;
        await sendNFTBookPurchaseEmail({
          email,
          isGift: !!giftInfo,
          giftInfo,
          notificationEmails,
          classId,
          bookName: className,
          priceName: priceNameEn,
          paymentId,
          claimToken,
          amountTotal: price,
          mustClaimToView,
          isPhysicalOnly,
          shippingDetails: null,
          from,
        });
      }
      res.json({ claimed, nftId });
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
      const { wallet, message } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      const { email, nftId } = await claimNFTBook(
        classId,
        paymentId,
        {
          message,
          wallet,
          token: token as string,
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimed',
        paymentId,
        classId,
        wallet,
        email,
        message,
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
