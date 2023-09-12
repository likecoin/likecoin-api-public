import { Router } from 'express';
import bodyParser from 'body-parser';
import BigNumber from 'bignumber.js';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { randomBytes } from 'crypto';
import uuidv4 from 'uuid/v4';

import Stripe from 'stripe';
import stripe from '../../../util/stripe';
import { COSMOS_CHAIN_ID, isValidLikeAddress } from '../../../util/cosmos';
import { sendTransactionWithSequence } from '../../../util/cosmos/tx';
import { db, likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixes } from '../../../middleware/likernft';
import { getFiatPriceStringForLIKE, getPriceInfoList } from '../../../util/api/likernft/fiat';
import { getImage, processStripeFiatNFTPurchase, findPaymentFromStripeSessionId } from '../../../util/api/likernft/fiat/stripe';
import { getNFTClassDataById, getLikerNFTPendingClaimSigningClientAndWallet } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { filterLikeNFTFiatData } from '../../../util/ValidationHelper';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  STRIPE_WEBHOOK_SECRET,
  LIKER_NFT_PENDING_CLAIM_ADDRESS,
} from '../../../../config/config';
import { processNFTBookPurchase } from '../../../util/api/likernft/book';
import { getLikerLandNFTClassPageURL, getLikerLandNFTFiatStripePurchasePageURL } from '../../../util/liker-land';

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
          metadata: { store } = {} as any,
        } = session;
        if (store === 'book') {
          await processNFTBookPurchase(session, req);
        } else {
          await processStripeFiatNFTPurchase(session, req);
        }
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

router.get(
  '/price',
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { iscnPrefixes, classIds } = res.locals;
      const priceInfoList = await getPriceInfoList(iscnPrefixes, classIds);
      const totalLIKEPrice = priceInfoList.reduce((acc, { LIKEPrice }) => acc + LIKEPrice, 0);
      const fiatPriceString = totalLIKEPrice === 0 ? '0' : await getFiatPriceStringForLIKE(totalLIKEPrice);
      const payload = {
        LIKEPrice: totalLIKEPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
        priceInfoList,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/new',
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!(wallet || LIKER_NFT_PENDING_CLAIM_ADDRESS) && !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const { memo, email } = req.body;
      const { iscnPrefixes, classIds } = res.locals;
      const [priceInfoList, classMetadataList] = await Promise.all([
        getPriceInfoList(iscnPrefixes, classIds),
        Promise.all(classIds.map(getNFTClassDataById)),
      ]);
      let {
        name = '',
        description = '',
      } = classMetadataList[0] as any;
      const images = classMetadataList.map(getImage).slice(0, 8);

      const totalLIKEPrice = priceInfoList.reduce((acc, { LIKEPrice }) => acc + LIKEPrice, 0);
      if (totalLIKEPrice === 0) throw new ValidationError('NFT_IS_FREE');
      const fiatPriceString = await getFiatPriceStringForLIKE(totalLIKEPrice);
      const paymentId = uuidv4();
      name = name.length > 100 ? `${name.substring(0, 99)}…` : name;
      description = description.length > 200 ? `${description.substring(0, 199)}…` : description;
      if (!description) { description = undefined; } // stripe does not like empty string
      if (classMetadataList.length > 1) {
        name = `${name} + ${classMetadataList.length - 1} more`;
      }

      const claimToken = randomBytes(32).toString('base64url');

      const priceInfoListString = JSON.stringify(priceInfoList);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: getLikerLandNFTFiatStripePurchasePageURL({
          classId: classIds[0],
          paymentId,
          token: claimToken,
          wallet: wallet as string,
        }),
        client_reference_id: wallet as string || undefined,
        customer_email: email,
        cancel_url: getLikerLandNFTClassPageURL({ classId: classIds[0] }),
        line_items: [
          {
            price_data: {
              currency: 'USD',
              product_data: {
                name,
                description,
                images,
                metadata: {
                  priceInfoListString,
                },
              },
              unit_amount: Number(new BigNumber(fiatPriceString).shiftedBy(2).toFixed(0)),
            },
            adjustable_quantity: {
              enabled: false,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          capture_method: 'manual',
        },
        metadata: {
          store: 'likerland',
          wallet: wallet as string,
          memo,
          priceInfoListString,
          paymentId,
        },
      });
      const { url, id: sessionId } = session;
      const docData: any = {
        type: 'stripe',
        sessionId,
        wallet,
        memo,
        priceInfoList,
        LIKEPrice: totalLIKEPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
        status: 'new',
        timestamp: Date.now(),
      };
      if (!wallet) {
        docData.claimToken = claimToken;
      }
      await likeNFTFiatCollection.doc(paymentId).create(docData);
      const LIKEPrice = totalLIKEPrice;
      const fiatPrice = Number(fiatPriceString);
      res.json({
        id: sessionId,
        url,
        LIKEPrice,
        fiatPrice,
        fiatPriceString,
        priceInfoList,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatPaymentNew',
        type: 'stripe',
        paymentId,
        buyerWallet: wallet,
        buyerMemo: memo,
        priceInfoList,
        fiatPrice,
        LIKEPrice,
        sessionId,
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
      let classId;
      let nftId;
      try {
        ({ classId, nftId } = await db.runTransaction(async (t) => {
          const doc = await t.get(ref);
          if (!doc.exists) throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
          const { status, claimToken } = doc.data();
          const { classId: _classId, nftId: _nftId } = doc.data();
          if (claimToken !== token) throw new ValidationError('INVALID_TOKEN', 403);
          if (status !== 'pendingClaim') throw new ValidationError('NFT_CLAIM_ALREADY_HANDLED', 409);
          t.update(ref, { status: 'claiming' });
          return { classId: _classId, nftId: _nftId };
        }));
      } catch (err) {
        if (err instanceof ValidationError && err.message === 'NFT_CLAIM_ALREADY_HANDLED') {
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'LikerNFTFiatClaimAlreadyHandled',
            paymentId,
            classId,
            nftId,
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
        const sendNFTSigningFunction = async ({ sequence }): Promise<TxRaw> => {
          const r = await client.sendNFTs(
            senderAddress,
            receiverWallet as string,
            classId,
            [nftId],
            {
              accountNumber,
              sequence,
              chainId: COSMOS_CHAIN_ID,
              broadcast: false,
            },
          );
          return r as TxRaw;
        };
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
          classId,
          nftId,
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
          classId,
          nftId,
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
        classId,
        nftId,
        txHash,
        wallet: receiverWallet,
      });

      res.json({ classId, nftId, txHash });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
