import { Router } from 'express';
import { ValidationError } from '../../../../util/ValidationError';
import {
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../util/api/likernft/book';
import { FieldValue, db, likeNFTCollectionCollection } from '../../../../util/firebase';
import publisher from '../../../../util/gcloudPub';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../../constant';
import { filterBookPurchaseData } from '../../../../util/ValidationHelper';
import { jwtAuth } from '../../../../middleware/jwt';
import { sendNFTBookGiftSentEmail, sendNFTBookShippedEmail } from '../../../../util/ses';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../../config/config';
import { calculatePayment } from '../../../../util/api/likernft/fiat';
import { claimNFTBookCollection, handleNewNFTBookCollectionStripeCheckout, sendNFTBookCollectionClaimedEmailNotification } from '../../../../util/api/likernft/book/collection/purchase';
import { getBookCollectionInfoById } from '../../../../util/api/likernft/collection/book';

const router = Router();

router.get('/:collectionId/new', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const {
      from,
      ga_client_id: gaClientId = '',
      utm_campaign: utmCampaign,
      utm_source: utmSource,
      utm_medium: utmMedium,
    } = req.query;

    const {
      url,
      paymentId,
      priceInDecimal,
      sessionId,
    } = await handleNewNFTBookCollectionStripeCheckout(collectionId, {
      gaClientId: gaClientId as string,
      from: from as string,
      utm: {
        campaign: utmCampaign as string,
        source: utmSource as string,
        medium: utmMedium as string,
      },
    });
    res.redirect(url);

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        collectionId,
        price: priceInDecimal / 100,
        sessionId,
        channel: from,
        isGift: false,
        utmCampaign,
        utmSource,
        utmMedium,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:collectionId/new', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const {
      from,
    } = req.query;
    const {
      gaClientId,
      giftInfo,
      utmCampaign,
      utmSource,
      utmMedium,
    } = req.body;

    if (giftInfo && !giftInfo.toEmail) {
      throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
    }

    const {
      url,
      paymentId,
      priceInDecimal,
      sessionId,
    } = await handleNewNFTBookCollectionStripeCheckout(collectionId, {
      gaClientId: gaClientId as string,
      from: from as string,
      giftInfo,
      utm: {
        campaign: utmCampaign,
        source: utmSource,
        medium: utmMedium,
      },
    });
    res.json({ url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        collectionId,
        price: priceInDecimal / 100,
        sessionId,
        channel: from,
        isGift: !!giftInfo,
        utmCampaign,
        utmSource,
        utmMedium,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:collectionId/price',
  async (req, res, next) => {
    try {
      const { collectionId } = req.params;

      const collectionData = await getBookCollectionInfoById(collectionId);
      const { priceInDecimal, canPayByLIKE } = collectionData;

      const {
        totalLIKEPricePrediscount,
        totalLIKEPrice,
        totalFiatPriceString,
      } = await calculatePayment([priceInDecimal]);
      const payload = {
        LIKEPricePrediscount: canPayByLIKE ? totalLIKEPricePrediscount : null,
        LIKEPrice: canPayByLIKE ? totalLIKEPrice : null,
        fiatPrice: Number(totalFiatPriceString),
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:collectionId/status/:paymentId',
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const doc = await likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).get();
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
  '/:collectionId/claim/:paymentId',
  async (req, res, next) => {
    try {
      const { collectionId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message } = req.body;

      const email = await claimNFTBookCollection(
        collectionId,
        paymentId,
        {
          message,
          wallet,
          token: token as string,
        },
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimed',
        paymentId,
        collectionId,
        wallet,
        email,
        message,
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
      // TODO: check tx content contains valid nft info and address
      const collectionRef = likeNFTCollectionCollection.doc(collectionId);
      const collectionDoc = await collectionRef.get();
      const collectionDocData = collectionDoc.data();
      if (!collectionDocData) throw new ValidationError('COLLECTION_ID_NOT_FOUND', 404);
      const { name, ownerWallet, moderatorWallets = [] } = collectionDocData;
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        // TODO: check tx is sent by req.user.wallet
        throw new ValidationError('NOT_OWNER', 403);
      }
      const paymentDocRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);

      const {
        email, isGift, giftInfo,
      } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          status,
        } = docData;
        if (status !== 'pendingNFT') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        t.update(paymentDocRef, {
          status: 'completed',
          txHash,
        });
        t.update(collectionRef, {
          'typePayload.pendingNFTCount': FieldValue.increment(-1),
        });
        return docData;
      });

      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
        } = giftInfo;
        await sendNFTBookGiftSentEmail({
          fromEmail: email,
          fromName,
          toName,
          bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
          txHash,
        });
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTSentUpdate',
        paymentId,
        collectionId,
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
        if (shippingStatus !== 'pending') {
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
