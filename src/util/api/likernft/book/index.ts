import Stripe from 'stripe';
import { ValidationError } from '../../../ValidationError';
import { FieldValue, db, likeNFTBookCollection } from '../../../firebase';
import stripe from '../../../stripe';
import { sendNFTBookPendingClaimEmail } from '../../../ses';

export async function newNftBookInfo(classId, data) {
  const {
    prices,
    ownerWallet,
    successUrl,
    cancelUrl,
  } = data;
  const newPrices = prices.map((p) => ({
    sold: 0,
    ...p,
  }));
  const payload: any = {
    classId,
    pendingNFTCount: 0,
    prices: newPrices,
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
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
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
      priceIndex: priceIndexString = '0',
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
  } = session;
  const priceIndex = Number(priceIndexString);
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email } = customer;
  try {
    const bookData = await db.runTransaction(async (t) => {
      const bookRef = likeNFTBookCollection.doc(classId);
      const doc = await t.get(bookRef);
      const docData = doc.data();
      if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
      const {
        prices,
      } = docData;
      const priceInfo = prices[priceIndex];
      if (!priceInfo) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const {
        stock,
      } = priceInfo;
      if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
      const paymentDoc = await t.get(bookRef.collection('transactions').doc(paymentId));
      const paymentData = paymentDoc.data();
      if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
      if (paymentData.status !== 'new') throw new ValidationError('PAYMENT_ALREADY_CLAIMED');
      priceInfo.stock = FieldValue.increment(-1);
      priceInfo.sold = FieldValue.increment(1);
      priceInfo.lastSaleTimestamp = FieldValue.serverTimestamp();
      t.update(bookRef, {
        prices,
        lastSaleTimestamp: FieldValue.serverTimestamp(),
      });
      t.update(bookRef.collection('transactions').doc(paymentId), {
        isPaid: true,
        isPendingClaim: true,
        status: 'paid',
        email,
      });
      return docData;
    });
    const { claimToken } = bookData;
    await stripe.paymentIntents.capture(paymentIntent as string);
    if (email) {
      await sendNFTBookPendingClaimEmail({
        email,
        classId,
        className: classId,
        paymentId,
        claimToken,
      });
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
