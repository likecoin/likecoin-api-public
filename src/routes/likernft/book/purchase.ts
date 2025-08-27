import { Router } from 'express';
import { ValidationError } from '../../../util/ValidationError';
import {
  checkIsAuthorized,
  getNFTClassDataById,
} from '../../../util/api/likernft/book';
import {
  db, likeNFTBookCartCollection, likeNFTBookCollection, FieldValue,
} from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import {
  LIKER_LAND_HOSTNAME,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
  ONE_DAY_IN_MS,
} from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import {
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookPendingClaimEmail,
} from '../../../util/ses';
import {
  LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES,
} from '../../../../config/config';
import {
  claimNFTBook,
  setNFTBookBuyerMessage,
  updateNFTBookPostDeliveryData,
} from '../../../util/api/likernft/book/purchase';
import { claimNFTBookCart, handleNewCartStripeCheckout } from '../../../util/api/likernft/book/cart';
import logPixelEvents from '../../../util/fbq';
import { getLikerLandCartURL, getLikerLandNFTClassPageURL } from '../../../util/liker-land';
import { isEVMClassId, triggerNFTIndexerUpdate } from '../../../util/evm/nft';
import { isValidEVMAddress } from '../../../util/evm';
import { isValidLikeAddress } from '../../../util/cosmos';
import { claimFreeBooks, getFreeBooksForUser } from '../../../util/api/likernft/book/free';

const router = Router();

router.get(
  '/cart/:cartId/status',
  jwtOptionalAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { cartId } = req.params;
      const { token } = req.query;
      if (!token && !req.user) throw new ValidationError('MISSING_TOKEN');
      const doc = await likeNFTBookCartCollection.doc(cartId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const { claimToken, wallet } = docData;
      if (token !== claimToken && (wallet && req.user?.wallet !== wallet)) {
        res.status(403).send('UNAUTHORIZED');
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
      site = undefined,
      language,
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
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
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
      cancelUrl: getLikerLandCartURL({
        type: 'book',
        utmCampaign,
        utmSource,
        utmMedium,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        site,
        language,
      }),
      site,
      language,
    });
    res.json({ paymentId, url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTCartPurchaseNew',
        type: 'stripe',
        email,
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
          productId: item.classId,
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
        evmWallet: req.user?.evmWallet,
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
      payment_method: paymentMethodQs,
      site: siteQs,
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;
    const quantity = parseInt(inputQuantity as string, 10) || 1;
    const httpMethod = 'GET';
    const referrer = (inputReferrer || req.get('Referrer')) as string;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const customPriceInDecimal = parseInt(inputCustomPriceInDecimal as string, 10) || undefined;

    let paymentMethods: string[] | undefined;
    if (paymentMethodQs) {
      if (Array.isArray(paymentMethodQs)) {
        paymentMethods = paymentMethodQs as string[];
      } else {
        paymentMethods = [paymentMethodQs as string];
      }
      paymentMethods.filter((pm) => (['link', 'card', 'crypto'].includes(pm)));
      if (paymentMethods.length === 0) paymentMethods = undefined;
    }

    let site: string | undefined;
    if (siteQs) {
      if (Array.isArray(siteQs)) {
        [site] = siteQs as string[];
      } else {
        site = siteQs as string;
      }
    }

    const {
      url,
      paymentId,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewCartStripeCheckout([{
      classId,
      priceIndex,
      customPriceInDecimal,
      quantity,
      from: from as string,
    }], {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      gadClickId: gadClickId as string,
      gadSource: gadSource as string,
      fbClickId: fbClickId as string,
      coupon: coupon as string,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      from: from as string,
      clientIp,
      referrer,
      utm: {
        campaign: utmCampaign as string,
        source: utmSource as string,
        medium: utmMedium as string,
      },
      httpMethod,
      paymentMethods,
      cancelUrl: getLikerLandNFTClassPageURL({
        classId,
        utmCampaign: utmCampaign as string,
        utmSource: utmSource as string,
        utmMedium: utmMedium as string,
        gaClientId: gaClientId as string,
        gaSessionId: gaSessionId as string,
        gadClickId: gadClickId as string,
        gadSource: gadSource as string,
        site,
      }),
      site,
    });
    res.redirect(url);

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        classId,
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
      evmWallet: req.user?.evmWallet,
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
      site,
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
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewCartStripeCheckout([{
      classId,
      priceIndex,
      customPriceInDecimal: parseInt(customPriceInDecimal, 10) || undefined,
      quantity,
      from: from as string,
    }], {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      coupon,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      email,
      from: from as string,
      referrer,
      giftInfo,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      httpMethod,
      userAgent,
      clientIp,
      cancelUrl: getLikerLandNFTClassPageURL({
        classId,
        utmCampaign,
        utmSource,
        utmMedium,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        site,
      }),
      site,
    });
    res.json({ paymentId, url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        email,
        paymentId,
        classId,
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
      evmWallet: req.user?.evmWallet,
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  ['/:classId/status/:paymentId', '/class/:classId/status/:paymentId'],
  jwtOptionalAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { token } = req.query;
      const [listingDoc, paymentDoc] = await Promise.all([
        likeNFTBookCollection.doc(classId).get(),
        likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).get(),
      ]);
      if (!listingDoc.exists || !paymentDoc.exists) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const docData = paymentDoc.data();
      const bookDocData = listingDoc.data();
      const { claimToken, wallet } = docData;
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      if (!token && !req.user) throw new ValidationError('MISSING_TOKEN', 401);
      const isTokenValid = token && token === claimToken;
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      const sessionWallet = req.user?.wallet;
      const isUserValid = sessionWallet
        && (sessionWallet === wallet || isAuthorized);
      if (!isTokenValid && !isUserValid) {
        throw new ValidationError('UNAUTHORIZED', 403);
      }
      res.json(filterBookPurchaseData(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.get('/free', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const freeBookNFTClassIds = await getFreeBooksForUser(req.user?.evmWallet);
    res.json(freeBookNFTClassIds);
  } catch (err) {
    next(err);
  }
});

router.post('/free', jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) throw new ValidationError('UNAUTHORIZED', 401);
    const { classId } = req.body;

    const {
      classIds,
      cartId,
      paymentId,
      claimToken,
    } = await claimFreeBooks(user.evmWallet, classId);
    res.json({
      classIds,
      cartId,
      paymentId,
      claimToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  ['/:classId/claim/:paymentId', '/class/:classId/claim/:paymentId'],
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message, loginMethod } = req.body;

      if (isEVMClassId(classId)) {
        if (!isValidEVMAddress(wallet)) {
          throw new ValidationError('INVALID_WALLET_ADDRESS');
        }
      } else if (!isValidLikeAddress(wallet)) {
        throw new ValidationError('INVALID_WALLET_ADDRESS');
      }
      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      const { nftId } = await claimNFTBook(
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

      res.json({ nftId });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/class/:classId/message/:paymentId',
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');
      if (!message) throw new ValidationError('MISSING_MESSAGE');

      await setNFTBookBuyerMessage(
        classId,
        paymentId,
        message,
        wallet,
        token as string,
        req,
      );

      res.sendStatus(200);
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
      const listingDoc = await likeNFTBookCollection.doc(classId).get();
      if (!listingDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = listingDoc.data();
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('UNAUTHORIZED', 403);
      const {
        email, wallet: toWallet, isGift, giftInfo,
      } = await db.runTransaction(async (t) => {
        const result = await updateNFTBookPostDeliveryData({
          classId,
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
        email,
        fromWallet: req.user.wallet,
        toWallet,
        quantity,
        // TODO: parse nftId and wallet from txHash,
        txHash,
        isGift,
      });

      if (isEVMClassId(classId)) {
        try {
          await triggerNFTIndexerUpdate({ classId });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`Failed to trigger NFT indexer update for class ${classId}:`, err);
        }
      }

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  ['/:classId/status/:paymentId/remind', '/class/:classId/status/:paymentId/remind'],
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { site } = req.body;
      const { wallet } = req.user;
      const [listingDoc, paymentDoc] = await Promise.all([
        likeNFTBookCollection.doc(classId).get(),
        likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).get(),
      ]);
      if (!listingDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      if (!paymentDoc.exists) throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
      const {
        ownerWallet,
        moderatorWallets = [],
      } = listingDoc.data();
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('UNAUTHORIZED', 403);
      const {
        email,
        status,
        isGift,
        giftInfo,
        claimToken,
        from,
        lastRemindTimestamp,
      } = paymentDoc.data();
      if (!email) throw new ValidationError('EMAIL_NOT_FOUND', 404);
      if (status !== 'paid') throw new ValidationError('STATUS_NOT_PAID', 409);
      if (lastRemindTimestamp?.toMillis() > Date.now() - ONE_DAY_IN_MS) {
        throw new ValidationError('TOO_FREQUENT_REMIND', 429);
      }
      const classData = await getNFTClassDataById(classId).catch(() => null);
      const className = classData?.name || classId;
      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
          toEmail,
          message,
        } = giftInfo;
        if (toEmail) {
          await sendNFTBookGiftPendingClaimEmail({
            fromName,
            toName,
            toEmail,
            message,
            classId,
            bookName: className,
            paymentId,
            claimToken,
            isResend: true,
            site,
          });
        }
      } else {
        await sendNFTBookPendingClaimEmail({
          email,
          classId,
          bookName: className,
          paymentId,
          claimToken,
          from,
          isResend: true,
          site,
        });
      }

      await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).update({
        lastRemindTimestamp: FieldValue.serverTimestamp(),
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimReminderSent',
        paymentId,
        classId,
        email,
        fromWallet: wallet,
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
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (
        !isAuthorized && !LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(wallet)
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
