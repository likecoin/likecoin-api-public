import BigNumber from 'bignumber.js';
import stripe from '../../../stripe';
import { likeNFTFiatCollection } from '../../../firebase';
import { ValidationError } from '../../../ValidationError';
import { processFiatNFTPurchase } from '.';

export async function findPaymentFromStripeSessionId(sessionId) {
  const query = await likeNFTFiatCollection.where('sessionId', '==', sessionId).limit(1).get();
  const [doc] = query.docs;
  return doc;
}

export async function processStripeFiatNFTPurchase(session, req) {
  const doc = await findPaymentFromStripeSessionId(session.id);
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
  if (fiatAmount.gt(paymentIntent.amount_capturable)) throw new ValidationError('ALREADY_CAPTURED');
  try {
    await processFiatNFTPurchase({
      paymentId, likeWallet: wallet, iscnPrefix, classId, LIKEPrice, fiatPrice,
    }, req);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    try {
      await stripe.paymentIntents.cancel(session.payment_intent);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
    return false;
  }
  await stripe.paymentIntents.capture(session.payment_intent, {
    amount_to_capture: fiatAmount.toNumber(),
  });
  return true;
}
