import { Router } from 'express';

import { ValidationError } from '../../../../util/ValidationError';
import { db, FieldValue, likeNFTCollectionCollection } from '../../../../util/firebase';
import publisher from '../../../../util/gcloudPub';
import {
  LIKER_LAND_HOSTNAME,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  ONE_DAY_IN_MS,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../../../constant';
import { filterBookPurchaseData } from '../../../../util/ValidationHelper';
import { jwtAuth, jwtOptionalAuth } from '../../../../middleware/jwt';
import {
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookPendingClaimEmail,
  sendNFTBookShippedEmail,
} from '../../../../util/ses';
import {
  LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES,
} from '../../../../../config/config';
import {
  claimNFTBookCollection,
  updateNFTBookCollectionPostDeliveryData,
} from '../../../../util/api/likernft/book/collection/purchase';
import logPixelEvents from '../../../../util/fbq';
import { checkIsAuthorized } from '../../../../util/api/likernft/book';
import { handleNewCartStripeCheckout } from '../../../../util/api/likernft/book/cart';
import { getLikerLandNFTCollectionPageURL } from '../../../../util/liker-land';

const router = Router();

router.get('/:collectionId/new', jwtOptionalAuth('read:nftcollection'), async (req, res, next) => {
  const { collectionId } = req.params;
  try {
    const {
      from,
      coupon,
      ga_client_id: gaClientId = '',
      ga_session_id: gaSessionId = '',
      gclid: gadClickId = '',
      gad_source: gadSource = '',
      utm_campaign: utmCampaign,
      utm_source: utmSource,
      utm_medium: utmMedium,
      custom_price: inputCustomPriceInDecimal,
      quantity: inputQuantity,
      referrer: inputReferrer,
      fbclid: fbClickId,
      payment_method: paymentMethodQs,
    } = req.query;

    const referrer = (inputReferrer || req.get('Referrer')) as string;
    const quantity = parseInt(inputQuantity as string, 10) || 1;
    const customPriceInDecimal = parseInt(inputCustomPriceInDecimal as string, 10) || undefined;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');

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
    const {
      url,
      paymentId,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewCartStripeCheckout([
      {
        collectionId,
        customPriceInDecimal,
        quantity,
        from: from as string,
      }], {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      gadClickId: gadClickId as string,
      gadSource: gadSource as string,
      fbClickId: fbClickId as string,
      likeWallet: req.user?.wallet,
      from: from as string,
      coupon: coupon as string,
      utm: {
        campaign: utmCampaign as string,
        source: utmSource as string,
        medium: utmMedium as string,
      },
      httpMethod: 'GET',
      referrer,
      userAgent,
      clientIp,
      paymentMethods,
      cancelUrl: getLikerLandNFTCollectionPageURL({
        collectionId,
        utmCampaign: utmCampaign as string,
        utmSource: utmSource as string,
        utmMedium: utmMedium as string,
        gaClientId: gaClientId as string,
        gaSessionId: gaSessionId as string,
        gadClickId: gadClickId as string,
        gadSource: gadSource as string,
      }),
    });
    res.redirect(url);

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        collectionId,
        price: priceInDecimal / 100,
        originalPrice: originalPriceInDecimal / 100,
        customPriceDiff: customPriceDiffInDecimal && customPriceDiffInDecimal / 100,
        sessionId,
        channel: from,
        isGift: false,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
      });
    }

    await logPixelEvents('InitiateCheckout', {
      items: [{ productId: collectionId, quantity }],
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
      console.error(`OUT_OF_STOCK: ${collectionId}`);
      res.redirect(`https://${LIKER_LAND_HOSTNAME}/nft/collection/${collectionId}`);
    } else {
      next(err);
    }
  }
});

router.post('/:collectionId/new', jwtOptionalAuth('read:nftcollection'), async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const {
      from,
    } = req.query;
    const {
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      fbClickId,
      giftInfo,
      coupon,
      email,
      customPriceInDecimal,
      utmCampaign,
      utmSource,
      utmMedium,
      referrer: inputReferrer,
    } = req.body;
    let { quantity = 1 } = req.body;
    quantity = parseInt(quantity, 10) || 1;

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
    } = await handleNewCartStripeCheckout([
      {
        collectionId,
        customPriceInDecimal: parseInt(customPriceInDecimal, 10) || undefined,
        quantity,
        from: from as string,
      }], {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      gadClickId: gadClickId as string,
      gadSource: gadSource as string,
      fbClickId: fbClickId as string,
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
      httpMethod: 'POST',
      referrer,
      userAgent,
      clientIp,
      cancelUrl: getLikerLandNFTCollectionPageURL({
        collectionId,
        utmCampaign,
        utmSource,
        utmMedium,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
      }),
    });
    res.json({ paymentId, url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        collectionId,
        email,
        price: priceInDecimal / 100,
        originalPrice: originalPriceInDecimal / 100,
        customPriceDiff: customPriceDiffInDecimal && customPriceDiffInDecimal / 100,
        sessionId,
        channel: from,
        isGift: !!giftInfo,
        utmCampaign,
        utmSource,
        utmMedium,
        referrer,
      });
    }

    await logPixelEvents('InitiateCheckout', {
      email,
      items: [{ productId: collectionId, quantity }],
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

router.get(
  '/:collectionId/status/:paymentId',
  jwtOptionalAuth('read:nftcollection'),
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const { token } = req.query;
      const [listingDoc, paymentDoc] = await Promise.all([
        likeNFTCollectionCollection.doc(collectionId).get(),
        likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).get(),
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

router.post(
  '/:collectionId/claim/:paymentId',
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message } = req.body;

      if (!token) throw new ValidationError('MISSING_TOKEN');
      if (!wallet) throw new ValidationError('MISSING_WALLET');

      await claimNFTBookCollection(
        collectionId,
        paymentId,
        {
          message,
          wallet,
          token: token as string,
        },
        req,
      );

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:collectionId/sent/:paymentId',
  jwtAuth('write:nftcollection'),
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const { txHash } = req.body;
      let { quantity = 1 } = req.body;
      quantity = parseInt(quantity, 10) || 1;
      const collectionDoc = await likeNFTCollectionCollection.doc(collectionId).get();
      if (!collectionDoc.exists) throw new ValidationError('COLLECTION_ID_NOT_FOUND', 404);
      const { name, ownerWallet, moderatorWallets = [] } = collectionDoc.data();
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('UNAUTHORIZED', 403);
      // TODO: check tx content contains valid nft info and address
      const {
        wallet, email, isGift, giftInfo,
      } = await db.runTransaction(async (t) => {
        const result = await updateNFTBookCollectionPostDeliveryData({
          collectionId,
          paymentId,
          txHash,
          quantity,
        }, t);
        return result;
      });

      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
        } = giftInfo;
        if (email) {
          await sendNFTBookGiftSentEmail({
            fromEmail: email,
            fromName,
            toName,
            bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
            txHash,
          });
        }
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTSentUpdate',
        paymentId,
        collectionId,
        email,
        fromWallet: req.user.wallet,
        toWallet: wallet,
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
  '/:collectionId/status/:paymentId/remind',
  jwtAuth('write:nftcollection'),
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const [listingDoc, paymentDoc] = await Promise.all([
        likeNFTCollectionCollection.doc(collectionId).get(),
        likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).get(),
      ]);
      if (!listingDoc.exists) throw new ValidationError('COLLECTION_ID_NOT_FOUND', 404);
      if (!paymentDoc.exists) throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
      const {
        name: collectionNameObj,
        ownerWallet,
        moderatorWallets = [],
      } = listingDoc.data();
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('UNAUTHORIZED', 403);
      const {
        email,
        isGift,
        giftInfo,
        status,
        claimToken,
        from,
        lastRemindTimestamp,
      } = paymentDoc.data();
      if (!email) throw new ValidationError('EMAIL_NOT_FOUND', 404);
      if (status !== 'paid') throw new ValidationError('STATUS_NOT_PAID', 409);
      if (lastRemindTimestamp?.toMillis() > Date.now() - ONE_DAY_IN_MS) {
        throw new ValidationError('TOO_FREQUENT_REMIND', 429);
      }
      const collectionName = typeof collectionNameObj === 'object' ? collectionNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionNameObj || '';
      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
          toEmail,
          message,
        } = giftInfo;
        if (email) {
          await sendNFTBookGiftPendingClaimEmail({
            fromName,
            toName,
            toEmail,
            message,
            collectionId,
            bookName: collectionName,
            paymentId,
            claimToken,
            isResend: true,
          });
        }
      } else {
        await sendNFTBookPendingClaimEmail({
          email,
          collectionId,
          bookName: collectionName,
          paymentId,
          claimToken,
          from,
          isResend: true,
        });
      }

      await likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).update({
        lastRemindTimestamp: FieldValue.serverTimestamp(),
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimReminderSent',
        paymentId,
        collectionId,
        email,
        fromWallet: req.user.wallet,
        isGift,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:collectionId/shipping/sent/:paymentId',
  jwtAuth('write:nftcollection'),
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const { message } = req.body;
      // TODO: check tx content contains valid nft info and address
      const collectionRef = likeNFTCollectionCollection.doc(collectionId);
      const collectionDoc = await collectionRef.get();
      const collectionDocData = collectionDoc.data();
      if (!collectionDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [], name } = collectionDocData;
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('UNAUTHORIZED', 403);
      const paymentDocRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);

      const { email } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          shippingStatus,
          status,
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
        if (isPhysicalOnly || status === 'completed') {
          t.update(collectionRef, {
            'typePayload.pendingNFTCount': FieldValue.increment(-1),
          });
        }
        t.update(paymentDocRef, updatePayload);
        return docData;
      });

      if (email) {
        await sendNFTBookShippedEmail({
          email,
          collectionId,
          bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
          message,
        });
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTShippingUpdate',
        paymentId,
        collectionId,
        email,
        ownerWallet: req.user.wallet,
        shippingMessage: message,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:collectionId/orders',
  jwtAuth('read:nftcollection'),
  async (req, res, next) => {
    try {
      const { collectionId } = req.params;
      const bookDoc = await likeNFTCollectionCollection.doc(collectionId).get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      const { wallet } = req.user;
      if (
        !isAuthorized
        && !LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(wallet)
      ) {
        throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
      }
      const query = await likeNFTCollectionCollection.doc(collectionId).collection('transactions')
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
  '/:collectionId/messages',
  async (req, res, next) => {
    try {
      const { collectionId } = req.params;
      const bookDoc = await likeNFTCollectionCollection.doc(collectionId).get();
      if (!bookDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const query = await likeNFTCollectionCollection.doc(collectionId).collection('transactions')
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
