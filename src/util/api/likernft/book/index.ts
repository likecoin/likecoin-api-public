import Stripe from 'stripe';
import { firestore } from 'firebase-admin';
import { ValidationError } from '../../../ValidationError';
import { FieldValue, db, likeNFTBookCollection } from '../../../firebase';
import stripe from '../../../stripe';
import { sendNFTBookPendingClaimEmail, sendNFTBookSalesEmail } from '../../../ses';
import { getNFTClassDataById } from '../../../cosmos/nft';
import publisher from '../../../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../../constant';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../../config/config';

export const MIN_BOOK_PRICE_DECIMAL = 90; // 0.90 USD
export const NFT_BOOK_TEXT_LOCALES = ['en', 'zh'];
export const NFT_BOOK_TEXT_DEFAULT_LOCALE = NFT_BOOK_TEXT_LOCALES[0];

export function formatPriceInfo(price) {
  const {
    name: nameInput,
    description: descriptionInput,
    priceInDecimal,
    hasShipping = false,
    stock,
  } = price;
  const name = {};
  const description = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    name[locale] = nameInput[locale];
    description[locale] = descriptionInput[locale];
  });
  return {
    name,
    description,
    priceInDecimal,
    hasShipping,
    stock,
  };
}

export function formatShippingRateInfo(shippingRate) {
  const {
    name: nameInput,
    priceInDecimal,
  } = shippingRate;
  const name = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    name[locale] = nameInput[locale];
  });
  return {
    name,
    priceInDecimal,
  };
}

export async function newNftBookInfo(classId, data) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (doc.exists) throw new ValidationError('CLASS_ID_ALREADY_EXISTS', 409);
  const {
    prices,
    ownerWallet,
    successUrl,
    cancelUrl,
    defaultPaymentCurrency = 'USD',
    notificationEmails,
    moderatorWallets,
    connectedWallets,
    shippingRates,
  } = data;
  const newPrices = prices.map((p, order) => ({
    order,
    sold: 0,
    ...formatPriceInfo(p),
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
  if (moderatorWallets) payload.moderatorWallets = moderatorWallets;
  if (notificationEmails) payload.notificationEmails = notificationEmails;
  if (connectedWallets) payload.connectedWallets = connectedWallets;
  if (shippingRates) payload.shippingRates = shippingRates.map((s) => formatShippingRateInfo(s));
  await likeNFTBookCollection.doc(classId).create(payload);
}

export async function updateNftBookInfo(classId: string, {
  prices,
  notificationEmails,
  moderatorWallets,
  connectedWallets,
  defaultPaymentCurrency,
  shippingRates,
}: {
  prices?: any[];
  notificationEmails?: string[];
  moderatorWallets?: string[];
  connectedWallets?: string[];
  defaultPaymentCurrency?: string;
  shippingRates?: any[];
} = {}) {
  const payload: any = {
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  };
  if (prices !== undefined) { payload.prices = prices; }
  if (notificationEmails !== undefined) { payload.notificationEmails = notificationEmails; }
  if (moderatorWallets !== undefined) { payload.moderatorWallets = moderatorWallets; }
  if (connectedWallets !== undefined) { payload.connectedWallets = connectedWallets; }
  if (defaultPaymentCurrency !== undefined) {
    payload.defaultPaymentCurrency = defaultPaymentCurrency;
  }
  if (shippingRates !== undefined) { payload.shippingRates = shippingRates; }
  await likeNFTBookCollection.doc(classId).update(payload);
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

export async function listNftBookInfoByModeratorWallet(moderatorWallet: string) {
  const MAX_BOOK_ITEMS_LIMIT = 256;
  const query = LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(moderatorWallet)
    ? await likeNFTBookCollection.limit(MAX_BOOK_ITEMS_LIMIT).get()
    : await likeNFTBookCollection.where('moderatorWallets', 'array-contains', moderatorWallet).limit(MAX_BOOK_ITEMS_LIMIT).get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}

export async function processNFTBookPurchase({
  classId,
  email,
  priceIndex,
  paymentId,
  shippingDetails,
  shippingCost,
}) {
  const hasShipping = !!shippingDetails;
  const { listingData, txData } = await db.runTransaction(async (t) => {
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
    priceInfo.stock -= 1;
    priceInfo.sold += 1;
    priceInfo.lastSaleTimestamp = firestore.Timestamp.now();
    t.update(bookRef, {
      prices,
      lastSaleTimestamp: FieldValue.serverTimestamp(),
    });
    const paymentPayload: any = {
      isPaid: true,
      isPendingClaim: true,
      hasShipping,
      status: 'paid',
      email,
    };
    if (hasShipping) paymentPayload.shippingStatus = 'pending';
    if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
    if (shippingCost) paymentPayload.shippingCost = shippingCost.amount_total / 100;
    t.update(bookRef.collection('transactions').doc(paymentId), paymentPayload);
    return {
      listingData: docData,
      txData: paymentData,
    };
  });
  return { listingData, txData };
}

export async function sendNFTBookPurchaseEmail({
  email,
  notificationEmails,
  classId,
  className,
  paymentId,
  claimToken,
  amountTotal,
}) {
  if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      classId,
      className,
      paymentId,
      claimToken,
    });
  }
  if (notificationEmails.length) {
    await sendNFTBookSalesEmail({
      buyerEmail: email,
      emails: notificationEmails,
      className,
      amount: (amountTotal || 0) / 100,
    });
  }
}

export async function processNFTBookStripePurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    metadata: {
      classId,
      iscnPrefix,
      paymentId,
      priceIndex: priceIndexString = '0',
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
    shipping_details: shippingDetails,
    shipping_cost: shippingCost,
  } = session;
  const priceIndex = Number(priceIndexString);
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email } = customer;
  try {
    const { txData, listingData } = await processNFTBookPurchase({
      classId,
      email,
      paymentId,
      priceIndex,
      shippingDetails,
      shippingCost,
    });
    const { notificationEmails = [] } = listingData;
    const {
      claimToken, price, priceName, type, from,
    } = txData;
    const [, classData] = await Promise.all([
      stripe.paymentIntents.capture(paymentIntent as string),
      getNFTClassDataById(classId).catch(() => null),
    ]);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseCaptured',
      type,
      paymentId,
      classId,
      iscnPrefix,
      price,
      priceName,
      priceIndex,
      fromChannel: from,
      sessionId: session.id,
    });

    const className = classData?.name || classId;
    await sendNFTBookPurchaseEmail({
      email,
      notificationEmails,
      classId,
      className,
      paymentId,
      claimToken,
      amountTotal,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseError',
      type: 'stripe',
      paymentId,
      classId,
      iscnPrefix,
      error: (err as Error).toString(),
      errorMessage,
      errorStack,
    });
    await likeNFTBookCollection.doc(classId).collection('transactions')
      .doc(paymentId).update({
        status: 'canceled',
        email,
      });
    await stripe.paymentIntents.cancel(paymentIntent as string)
      .catch((error) => console.error(error)); // eslint-disable-line no-console
  }
}

export function parseBookSalesData(priceData, isAuthorized) {
  let sold = 0;
  let stock = 0;
  const prices: any[] = [];
  priceData.forEach((p, index) => {
    const {
      name,
      description,
      priceInDecimal,
      hasShipping,
      sold: pSold = 0,
      stock: pStock = 0,
      order = index,
    } = p;
    const price = priceInDecimal / 100;
    const payload: any = {
      index,
      price,
      name,
      description,
      stock: pStock,
      isSoldOut: pStock <= 0,
      hasShipping,
      order,
    };
    if (isAuthorized) {
      payload.sold = pSold;
    }
    prices.push(payload);
    sold += pSold;
    stock += pStock;
  });
  prices.sort((a, b) => a.order - b.order);
  return {
    sold,
    stock,
    prices,
  };
}

export function validatePrice(price: any) {
  const {
    priceInDecimal,
    stock,
    name = {},
    description = {},
  } = price;
  if (!(priceInDecimal > 0
    && (typeof priceInDecimal === 'number')
    && priceInDecimal >= MIN_BOOK_PRICE_DECIMAL)) {
    throw new ValidationError('INVALID_PRICE');
  }
  if (!(typeof stock === 'number' && stock >= 0)) {
    throw new ValidationError('INVALID_PRICE_STOCK');
  }
  if (!(typeof name[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'
    && Object.values(name).every((n) => typeof n === 'string'))) {
    throw new ValidationError('INVALID_PRICE_NAME');
  }
  if (!(typeof description[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'
    && Object.values(description).every((n) => typeof n === 'string'))) {
    throw new ValidationError('INVALID_PRICE_DESCRIPTION');
  }
}

export function validatePrices(prices: any[]) {
  if (!prices.length) throw new ValidationError('PRICES_ARE_EMPTY');
  let i = 0;
  try {
    for (i = 0; i < prices.length; i += 1) {
      validatePrice(prices[i]);
    }
  } catch (err) {
    const errorMessage = `${(err as Error).message}_in_${i}`;
    throw new ValidationError(errorMessage);
  }
}
