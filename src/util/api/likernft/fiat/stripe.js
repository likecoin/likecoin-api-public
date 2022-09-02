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
    iscnId,
    LIKEPrice,
    fiatPrice,
    status,
  } = docData;
  const paymentId = doc.id;
  if (type !== 'stripe') throw new ValidationError('PAYMENT_TYPE_NOT_STRIPE');
  if (status !== 'new') return true; // handled or handling
  const fiatAmount = fiatPrice * 100;
  const paymentIntent = await stripe.paymentIntents.get(session.payment_intent);
  try {
    if (paymentIntent.amount_capturable < fiatAmount) throw new ValidationError('ALREADY_CAPTURED');
    await processFiatNFTPurchase({
      paymentId, likeWallet: wallet, iscnPrefix: iscnId, classId, LIKEPrice,
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
    amount_to_capture: fiatPrice * 100,
  });
  return true;
}
