import { Router } from 'express';
import bodyParser from 'body-parser';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { randomBytes } from 'crypto';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import uuidv4 from 'uuid/v4';

import Stripe from 'stripe';
import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { getSendMessagesSigningFunction, sendTransactionWithSequence } from '../../../util/cosmos/tx';
import { db, likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixes } from '../../../middleware/likernft';
import { getPurchaseInfoList, calculatePayment } from '../../../util/api/likernft/fiat';
import {
  processStripeFiatNFTPurchase,
  findPaymentFromStripeSessionId,
  formatLineItem,
  handlePromotionalEmails,
} from '../../../util/api/likernft/fiat/stripe';
import { getNFTClassDataById, getLikerNFTPendingClaimSigningClientAndWallet } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { filterLikeNFTFiatData } from '../../../util/ValidationHelper';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  STRIPE_WEBHOOK_SECRET,
  LIKER_NFT_PENDING_CLAIM_ADDRESS,
} from '../../../../config/config';
import { getLikerLandNFTClassPageURL, getLikerLandNFTFiatStripePurchasePageURL } from '../../../util/liker-land';
import { processNFTBookStripePurchase } from '../../../util/api/likernft/book/purchase';
import { processNFTBookCollectionStripePurchase } from '../../../util/api/likernft/book/collection/purchase';

const router = Router();

router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      // eslint-disable-next-line no-console
      console.error('no stripe signature');
      res.sendStatus(400);
      return;
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        message: err, stack: (err as Error).stack,
      }));
      res.sendStatus(400);
      return;
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const session: Stripe.Checkout.Session = event.data.object;
        const {
          metadata: { store, collectionId } = {} as any,
        } = session;
        if (store === 'book') {
          if (collectionId) {
            await processNFTBookCollectionStripePurchase(session, req);
          } else {
            await processNFTBookStripePurchase(session, req);
          }
        } else {
          await processStripeFiatNFTPurchase(session, req);
        }
        await handlePromotionalEmails(session, req);
        break;
      }
      case 'invoice.paid':
      default: {
        res.sendStatus(415);
        return;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/new',
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!(wallet || LIKER_NFT_PENDING_CLAIM_ADDRESS) && !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const {
        gaClientId = '',
        gaSessionId = '',
        memo = '',
        email,
        utmCampaign,
        utmSource,
        utmMedium,
      } = req.body;
      const { iscnPrefixes, classIds } = res.locals;
      const [purchaseInfoList, classMetadataList] = await Promise.all([
        getPurchaseInfoList(iscnPrefixes, classIds),
        Promise.all(classIds.map(getNFTClassDataById)),
      ]);
      const prices = purchaseInfoList.map((p) => p.price);
      const {
        totalLIKEPrice: LIKEPrice,
        totalFiatPriceString: fiatPriceString,
      } = await calculatePayment(prices);
      const fiatPrice = Number(fiatPriceString);
      if (LIKEPrice === 0) throw new ValidationError('NFT_IS_FREE');
      const paymentId = uuidv4();
      const claimToken = wallet ? '' : randomBytes(32).toString('base64url');

      const classIdLog = {};
      // Metadata can have up to 50 keys
      classIds.slice(0, 45).forEach((classId, i) => {
        classIdLog[`classId${i + 1}`] = classId;
      });

      const lineItems = classMetadataList.map(
        (classMetadata, i) => formatLineItem(classMetadata, purchaseInfoList[i].price),
      ) as any[];

      const sessionMetadata: any = {
        store: 'likerland',
        wallet: wallet as string,
        memo,
        gaClientId,
        gaSessionId,
        paymentId,
        totalNFTClassCount: classIds.length,
        httpMethod: 'POST',
        ...classIdLog,
      };

      if (utmCampaign) sessionMetadata.utmCampaign = utmCampaign;
      if (utmSource) sessionMetadata.utmSource = utmSource;
      if (utmMedium) sessionMetadata.utmMedium = utmMedium;
      if (gaClientId) sessionMetadata.gaClientId = gaClientId;
      if (gaSessionId) sessionMetadata.gaSessionId = gaSessionId;
      const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        success_url: getLikerLandNFTFiatStripePurchasePageURL({
          classId: classIds[0],
          paymentId,
          token: claimToken,
          utmCampaign,
          utmSource,
          utmMedium,
          gaClientId,
          gaSessionId,
        }),
        client_reference_id: wallet as string || undefined,
        customer_email: email,
        cancel_url: getLikerLandNFTClassPageURL({
          classId: classIds[0],
          utmCampaign,
          utmSource,
          utmMedium,
          gaClientId,
          gaSessionId,
        }),
        line_items: lineItems,
        payment_intent_data: {
          metadata: sessionMetadata,
          capture_method: 'manual',
        },
        consent_collection: {
          promotions: 'auto',
        },
        metadata: sessionMetadata,
      };
      if (email) checkoutPayload.customer_email = email;
      const session = await stripe.checkout.sessions.create(checkoutPayload);
      const { url, id: sessionId } = session;
      const docData: any = {
        type: 'stripe',
        sessionId,
        memo,
        purchaseInfoList,
        LIKEPrice,
        fiatPrice,
        fiatPriceString,
        status: 'new',
        timestamp: Date.now(),
      };
      if (wallet) {
        docData.wallet = wallet;
      } else {
        docData.claimToken = claimToken;
      }
      await likeNFTFiatCollection.doc(paymentId).create(docData);
      res.json({
        id: sessionId,
        url,
        LIKEPrice,
        fiatPrice,
        fiatPriceString,
        purchaseInfoList,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatPaymentNew',
        type: 'stripe',
        paymentId,
        buyerWallet: wallet,
        buyerMemo: memo,
        purchaseInfoList,
        fiatPrice,
        LIKEPrice,
        sessionId,
        utmCampaign,
        utmSource,
        utmMedium,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/status',
  async (req, res, next) => {
    try {
      const { payment_id: paymentId, session_id: sessionId } = req.query;
      if (!paymentId && !sessionId) throw new ValidationError('PAYMENT_ID_NEEDED');
      let doc;
      if (paymentId) {
        doc = await likeNFTFiatCollection.doc(paymentId).get();
      } else {
        doc = await findPaymentFromStripeSessionId(sessionId);
      }
      if (!doc.data()) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const docData = doc.data();
      res.json(filterLikeNFTFiatData(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/pending/count',
  async (req, res, next) => {
    try {
      const { email } = req.query;
      if (!email) throw new ValidationError('EMAIL_NEEDED');
      const snapshot = await likeNFTFiatCollection
        .where('email', '==', email)
        .where('status', '==', 'pendingClaim')
        .get();
      res.json({ count: snapshot.docs.length });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/pending/claim',
  async (req, res, next) => {
    try {
      const {
        wallet: receiverWallet,
        payment_id: paymentId,
        token,
      } = req.query;
      if (!receiverWallet || !isValidLikeAddress(receiverWallet)) throw new ValidationError('INVALID_WALLET_ADDRESS');
      if (!paymentId) throw new ValidationError('PAYMENT_ID_NEEDED');
      if (!token) throw new ValidationError('TOKEN_NEEDED');

      const ref = likeNFTFiatCollection.doc(paymentId);
      let purchaseInfoList;
      try {
        (purchaseInfoList = await db.runTransaction(async (t) => {
          const doc = await t.get(ref);
          if (!doc.exists) throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
          const {
            status,
            claimToken,
            purchaseInfoList: _purchaseInfoList,
            // TODO: retire this after all legacy pendingClaim has been claimed
            classId: _classId,
            nftId: _nftId,
          } = doc.data();
          if (claimToken !== token) throw new ValidationError('INVALID_TOKEN', 403);
          if (status !== 'pendingClaim') throw new ValidationError('NFT_CLAIM_ALREADY_HANDLED', 409);
          t.update(ref, { status: 'claiming' });
          return _purchaseInfoList
            ? _purchaseInfoList.map((p) => ({ classId: p.classId, nftId: p.nftId }))
            : [{ classId: _classId, nftId: _nftId }];
        }));
      } catch (err) {
        if (err instanceof ValidationError && err.message === 'NFT_CLAIM_ALREADY_HANDLED') {
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'LikerNFTFiatClaimAlreadyHandled',
            paymentId,
            purchaseInfoList,
            wallet: receiverWallet,
          });
        }
        throw err;
      }

      let txRes;
      try {
        const {
          client,
          wallet: senderWallet,
          accountNumber,
        } = await getLikerNFTPendingClaimSigningClientAndWallet();
        const { address: senderAddress } = senderWallet;
        const messages = purchaseInfoList.map(({ classId, nftId }) => formatMsgSend(
          senderAddress,
          receiverWallet as string,
          classId,
          nftId,
        ));
        const sendNFTSigningFunction = getSendMessagesSigningFunction({
          iscnSigningClient: client,
          address: senderAddress,
          messages,
          accountNumber,
        });
        txRes = await sendTransactionWithSequence(
          senderAddress,
          sendNFTSigningFunction,
        );
      } catch (err) {
        const error = (err as Error).toString();
        const errorMessage = (err as Error).message;
        const errorStack = (err as Error).stack;
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTFiatClaimServerError',
          paymentId,
          purchaseInfoList,
          error,
          errorMessage,
          errorStack,
        });
        await ref.update({
          status: 'error',
          error,
          errorMessage,
          errorStack,
        });
        throw err;
      }
      const { transactionHash: txHash, code } = txRes as DeliverTxResponse;
      if (code) {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTFiatClaimTxError',
          paymentId,
          purchaseInfoList,
          errorCode: code,
          errorTransactionHash: txHash,
        });
        await ref.update({
          status: 'error',
          errorCode: code,
          errorTransactionHash: txHash,
        });
        throw new ValidationError(`TX_${txHash}_FAILED_WITH_CODE_${code}`);
      }
      await ref.update({
        status: 'done',
        wallet: receiverWallet,
        claimTransactionHash: txHash,
        claimTimestamp: Date.now(),
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatClaimed',
        paymentId,
        purchaseInfoList,
        txHash,
        wallet: receiverWallet,
      });

      res.json({ purchaseInfoList, txHash });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
