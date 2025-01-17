import { Router } from 'express';
import crypto from 'crypto';
import uuidv4 from 'uuid/v4';

import { ValidationError } from '../../../../util/ValidationError';
import { db, likeNFTCollectionCollection } from '../../../../util/firebase';
import publisher from '../../../../util/gcloudPub';
import {
  LIKER_LAND_HOSTNAME,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../../../constant';
import { filterBookPurchaseData } from '../../../../util/ValidationHelper';
import { jwtAuth, jwtOptionalAuth } from '../../../../middleware/jwt';
import {
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookOutOfStockEmail,
  sendNFTBookPendingClaimEmail,
  sendNFTBookShippedEmail,
} from '../../../../util/ses';
import {
  LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES,
  SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD,
} from '../../../../../config/config';
import {
  claimNFTBookCollection,
  createNewNFTBookCollectionPayment,
  handleNewNFTBookCollectionStripeCheckout,
  processNFTBookCollectionPurchase,
  sendNFTBookCollectionClaimedEmailNotification,
  sendNFTBookCollectionPurchaseEmail,
  updateNFTBookCollectionPostDeliveryData,
} from '../../../../util/api/likernft/book/collection/purchase';
import { getBookCollectionInfoById } from '../../../../util/api/likernft/collection/book';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../../util/slack';
import { subscribeEmailToLikerLandSubstack } from '../../../../util/substack';
import { createAirtableBookSalesRecordFromFreePurchase } from '../../../../util/airtable';
import logPixelEvents from '../../../../util/fbq';

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
    } = req.query;

    const referrer = (inputReferrer || req.get('Referrer')) as string;
    const quantity = parseInt(inputQuantity as string, 10) || 1;
    const customPriceInDecimal = parseInt(inputCustomPriceInDecimal as string, 10) || undefined;
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const {
      url,
      paymentId,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiffInDecimal,
      sessionId,
    } = await handleNewNFTBookCollectionStripeCheckout(collectionId, {
      gaClientId: gaClientId as string,
      gaSessionId: gaSessionId as string,
      gadClickId: gadClickId as string,
      gadSource: gadSource as string,
      fbClickId: fbClickId as string,
      likeWallet: req.user?.wallet,
      from: from as string,
      coupon: coupon as string,
      quantity,
      customPriceInDecimal,
      utm: {
        campaign: utmCampaign as string,
        source: utmSource as string,
        medium: utmMedium as string,
      },
      httpMethod: 'GET',
      referrer,
      userAgent,
      clientIp,
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
    } = await handleNewNFTBookCollectionStripeCheckout(collectionId, {
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
      quantity,
      customPriceInDecimal: parseInt(customPriceInDecimal, 10) || undefined,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
      httpMethod: 'POST',
      referrer,
      userAgent,
      clientIp,
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

router.post(
  '/:collectionId/new/free',
  async (req, res, next) => {
    try {
      const { collectionId } = req.params;
      const { from = '' } = req.query;
      const {
        email = '',
        wallet,
        message,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        fbClickId,
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

      const collectionInfo = await getBookCollectionInfoById(collectionId);
      if (!collectionInfo) throw new ValidationError('NFT_NOT_FOUND');
      const {
        notificationEmails,
        mustClaimToView = false,
        priceInDecimal,
        stock,
        name: collectionNameObj,
        isPhysicalOnly = false,
        ownerWallet,
      } = collectionInfo;
      const collectionName = typeof collectionNameObj === 'object' ? collectionNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionNameObj || '';
      if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
      if (priceInDecimal > 0) throw new ValidationError('NOT_FREE_PRICE');

      const collectionRef = likeNFTCollectionCollection.doc(collectionId);
      if (email) {
        const query = await collectionRef.collection('transactions')
          .where('email', '==', email)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }
      if (wallet) {
        const query = await collectionRef.collection('transactions')
          .where('wallet', '==', wallet)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }

      const paymentId = uuidv4();
      const claimToken = crypto.randomBytes(32).toString('hex');

      await createNewNFTBookCollectionPayment(collectionId, paymentId, {
        type: 'free',
        email,
        claimToken,
        priceInDecimal,
        originalPriceInDecimal: priceInDecimal,
        isPhysicalOnly,
        from: from as string,
      });

      const { listingData } = await processNFTBookCollectionPurchase({
        collectionId,
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
        collectionId,
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

      // Remove after refactoring free purchase into purchase
      await createAirtableBookSalesRecordFromFreePurchase({
        collectionId,
        paymentId,
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

      const notifications: Promise<any>[] = [
        sendNFTBookCollectionPurchaseEmail({
          isGift: false,
          giftInfo: null,
          email,
          notificationEmails,
          collectionId,
          collectionName,
          paymentId,
          claimToken,
          amountTotal: 0,
          quantity: 1,
          mustClaimToView,
          isPhysicalOnly,
          shippingDetails: null,
          from,
        }),
        sendNFTBookSalesSlackNotification({
          collectionId,
          bookName: collectionName,
          priceName: collectionName,
          paymentId,
          email,
          priceWithCurrency: 'FREE',
          method: 'free',
        }),
      ];
      const newStock = listingData?.typePayload?.stock;
      const isOutOfStock = newStock <= 0;
      if (newStock <= SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD) {
        notifications.push(sendNFTBookOutOfStockSlackNotification({
          collectionId,
          className: collectionName,
          priceName: '',
          priceIndex: 0,
          notificationEmails,
          wallet: ownerWallet,
          stock: newStock,
        }));
      }
      if (isOutOfStock) {
        notifications.push(sendNFTBookOutOfStockEmail({
          emails: notificationEmails,
          collectionId,
          bookName: collectionName,
          priceName: '',
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

      if (wallet) {
        await claimNFTBookCollection(
          collectionId,
          paymentId,
          {
            message,
            wallet,
            loginMethod,
            token: claimToken as string,
          },
          req,
        );

        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTClaimed',
          paymentId,
          collectionId,
          wallet,
          email,
          buyerMessage: message,
        });

        await sendNFTBookCollectionClaimedEmailNotification(
          collectionId,
          paymentId,
          {
            message,
            wallet,
            email,
          },
        );
      }

      res.json({ claimed: !!wallet });
    } catch (err) {
      next(err);
    }
  },
);

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
      const sessionWallet = req.user?.wallet;
      const isUserValid = sessionWallet
        && (sessionWallet === wallet
          || sessionWallet === ownerWallet
          || moderatorWallets.includes(sessionWallet));
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

      const { email } = await claimNFTBookCollection(
        collectionId,
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
        collectionId,
        wallet,
        email,
        buyerMessage: message,
      });
      await sendNFTBookCollectionClaimedEmailNotification(
        collectionId,
        paymentId,
        {
          message,
          wallet,
          email,
        },
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

      // TODO: check tx content contains valid nft info and address
      const {
        wallet, name, email, isGift, giftInfo,
      } = await db.runTransaction(async (t) => {
        const result = await updateNFTBookCollectionPostDeliveryData({
          collectionId,
          callerWallet: req.user.wallet,
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
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        throw new ValidationError('NOT_OWNER', 403);
      }
      const {
        email,
        isGift,
        giftInfo,
        status,
        claimToken,
        from,
      } = paymentDoc.data();
      if (!email) throw new ValidationError('EMAIL_NOT_FOUND', 404);
      if (status !== 'paid') throw new ValidationError('STATUS_NOT_PAID', 409);
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
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        // TODO: check tx is sent by req.user.wallet
        throw new ValidationError('NOT_OWNER', 403);
      }
      const paymentDocRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);

      const { email } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          shippingStatus,
          hasShipping,
        } = docData;
        if (!hasShipping) {
          throw new ValidationError('PAYMENT_DOES_NOT_HAS_SHIPPING', 409);
        }
        if (shippingStatus === 'shipped') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        t.update(paymentDocRef, {
          shippingStatus: 'shipped',
          shippingMessage: message,
        });
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
      const { wallet } = req.user;
      if (
        ownerWallet !== wallet
        && !moderatorWallets.includes(wallet)
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
