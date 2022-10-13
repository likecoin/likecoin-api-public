import BigNumber from 'bignumber.js';
import axios from 'axios';
import stripe from '../../../stripe';
import { likeNFTFiatCollection } from '../../../firebase';
import { ValidationError } from '../../../ValidationError';
import { processFiatNFTPurchase } from '.';
import { IS_TESTNET, PUBSUB_TOPIC_MISC } from '../../../../constant';
import publisher from '../../../gcloudPub';
import { NFT_MESSAGE_WEBHOOK } from '../../../../../config/config';

export async function findPaymentFromStripeSessionId(sessionId) {
  const query = await likeNFTFiatCollection.where('sessionId', '==', sessionId).limit(1).get();
  const [doc] = query.docs;
  return doc;
}

export async function processStripeFiatNFTPurchase(session, req) {
  const {
    id: sessionId,
    metadata = {},
    customer_details: customer = {},
  } = session;
  const doc = await findPaymentFromStripeSessionId(sessionId);
  if (!doc) throw new ValidationError('PAYMENT_SESSION_NOT_FOUND');
  const docData = doc.data();
  if (!docData) throw new ValidationError('PAYMENT_SESSION_NOT_FOUND');
  const {
    type,
    wallet,
    classId,
    iscnPrefix,
    LIKEPrice,
    fiatPrice,
    fiatPriceString,
    status,
  } = docData;
  const paymentId = doc.id;
  if (type !== 'stripe') throw new ValidationError('PAYMENT_TYPE_NOT_STRIPE');
  if (status !== 'new') return true; // handled or handling
  const fiatAmount = new BigNumber(fiatPriceString).shiftedBy(2);
  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
  if (fiatAmount.gt(paymentIntent.amount_capturable)) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentError',
      type: 'stripe',
      paymentId,
      buyerWallet: wallet,
      classId,
      iscnPrefix,
      fiatPrice,
      LIKEPrice,
      sessionId,
      error: 'ALREADY_CAPTURED',
    });
    throw new ValidationError('ALREADY_CAPTURED');
  }
  try {
    await processFiatNFTPurchase({
      paymentId, likeWallet: wallet, iscnPrefix, classId, LIKEPrice, fiatPrice,
    }, req);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    const errorMessage = error.message;
    const errorStack = error.stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentError',
      type: 'stripe',
      paymentId,
      buyerWallet: wallet,
      classId,
      iscnPrefix,
      fiatPrice,
      LIKEPrice,
      sessionId,
      error: error.toString(),
      errorMessage,
      errorStack,
    });
    if (error instanceof ValidationError) {
      try {
        await stripe.paymentIntents.cancel(session.payment_intent);
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTFiatPaymentCancel',
          type: 'stripe',
          paymentId,
          buyerWallet: wallet,
          classId,
          iscnPrefix,
          fiatPrice,
          LIKEPrice,
          sessionId,
          error: error.toString(),
          errorMessage,
          errorStack,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
    return false;
  }
  await stripe.paymentIntents.capture(session.payment_intent, {
    amount_to_capture: fiatAmount.toNumber(),
  });
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'LikerNFTFiatPaymentCaptured',
    type: 'stripe',
    paymentId,
    buyerWallet: wallet,
    classId,
    iscnPrefix,
    fiatPrice,
    LIKEPrice,
    sessionId,
  });
  if (NFT_MESSAGE_WEBHOOK) {
    try {
      const {
        wallet: metadataWallet,
        // iscnPrefix,
        // paymentId,
        isPendingClaim,
      } = metadata;
      const { email } = customer;
      let text = `${metadataWallet || email} bought ${classId} for ${fiatPriceString}, paymentId ${paymentId}`;
      if (isPendingClaim) text = `(Unclaimed NFT) ${text}`;
      if (IS_TESTNET) text = `(TESTNET) ${text}`;
      await axios.post(NFT_MESSAGE_WEBHOOK, { text });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  return true;
}
