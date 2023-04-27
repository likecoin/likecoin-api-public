import Stripe from 'stripe';
import { ValidationError } from '../../../ValidationError';
import { FieldValue, db, likeNFTBookCollection } from '../../../firebase';
import stripe from '../../../stripe';

export async function newNftBookInfo(classId, data) {
  const {
    stock,
    decimalPrice,
    ownerWallet,
  } = data;
  await likeNFTBookCollection.doc(classId).create({
    classId,
    stock,
    decimalPrice,
    ownerWallet,
    timestamp: FieldValue.serverTimestamp,
  });
}

export async function getNftBookInfo(classId) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND');
  return doc.data();
}

export async function handleBookPurchase(classId) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND');
  return doc.data();
}

export async function processNFTBookPurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    metadata: {
      classId,
      paymentId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
  } = session;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email } = customer;
  try {
    await db.runTransaction(async (t) => {
      const bookRef = likeNFTBookCollection.doc(classId);
      const doc = await t.get(bookRef);
      const docData = doc.data();
      if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
      if (docData.stock <= 0) throw new ValidationError('OUT_OF_STOCK');
      t.update(bookRef, { stock: FieldValue.increment(-1) });
      t.update(bookRef.collection('transactions').doc(paymentId), {
        isPaid: true,
        isPendingClaim: true,
        status: 'paid',
        email,
      });
    });
    await stripe.paymentIntents.capture(paymentIntent as string);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    await likeNFTBookCollection.doc(classId).collection('transactions')
      .doc(paymentId).update({
        status: 'canceled',
        email,
      });
    await stripe.paymentIntents.cancel(paymentIntent as string)
      .catch((error) => console.error(error)); // eslint-disable-line no-console
  }
}
