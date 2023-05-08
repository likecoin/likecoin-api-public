import crypto from 'crypto';
import Stripe from 'stripe';
import { ValidationError } from '../../../ValidationError';
import { FieldValue, db, likeNFTBookCollection } from '../../../firebase';
import stripe from '../../../stripe';
import { sendPendingClaimEmail } from '../../../ses';

export async function newNftBookInfo(classId, data) {
  const {
    stock,
    priceInDecimal,
    ownerWallet,
    successUrl,
    cancelUrl,
  } = data;
  const payload: any = {
    classId,
    sold: 0,
    pendingNFTCount: 0,
    stock,
    priceInDecimal,
    ownerWallet,
    timestamp: FieldValue.serverTimestamp(),
  };
  if (successUrl) payload.successUrl = successUrl;
  if (cancelUrl) payload.cancelUrl = cancelUrl;
  await likeNFTBookCollection.doc(classId).create(payload);
}

export async function getNftBookInfo(classId) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND');
  return doc.data();
}

export async function listNftBookInfoByOwnerWallet(ownerWallet: string) {
  const query = await likeNFTBookCollection.where('ownerWallet', '==', ownerWallet).get();
  return query.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
  const claimToken = crypto.randomBytes(32).toString('hex');
  try {
    await db.runTransaction(async (t) => {
      const bookRef = likeNFTBookCollection.doc(classId);
      const doc = await t.get(bookRef);
      const docData = doc.data();
      if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
      if (docData.stock <= 0) throw new ValidationError('OUT_OF_STOCK');

      const paymentDoc = await t.get(bookRef.collection('transactions').doc(paymentId));
      const paymentData = paymentDoc.data();
      if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
      if (paymentData.status !== 'new') throw new ValidationError('PAYMENT_ALREADY_CLAIMED');
      t.update(bookRef, {
        stock: FieldValue.increment(-1),
        sold: FieldValue.increment(1),
        lastSaleTimestamp: FieldValue.serverTimestamp(),
      });
      t.update(bookRef.collection('transactions').doc(paymentId), {
        isPaid: true,
        isPendingClaim: true,
        status: 'paid',
        claimToken,
        email,
      });
    });
    await stripe.paymentIntents.capture(paymentIntent as string);
    // TODO: modify function for nft book
    if (email) {
      await sendPendingClaimEmail(email, classId, claimToken);
    }
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
