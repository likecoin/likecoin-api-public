import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';

import { NFT_BOOK_TEXT_DEFAULT_LOCALE } from '..';
import { getNFTClassDataById } from '../../../../cosmos/nft';
import { ValidationError } from '../../../../ValidationError';
import {
  getLikerLandNFTClaimPageURL,
  getLikerLandNFTCollectionPageURL,
  getLikerLandNFTGiftPageURL,
} from '../../../../liker-land';
import {
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  PUBSUB_TOPIC_MISC,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  USD_TO_HKD_RATIO,
} from '../../../../../constant';
import { parseImageURLFromMetadata } from '../../metadata';
import {
  TransactionFeeInfo,
  formatStripeCheckoutSession, getCouponDiscountRate, handleStripeConnectedAccount,
} from '../purchase';
import stripe from '../../../../stripe';
import { likeNFTCollectionCollection, FieldValue, db } from '../../../../firebase';
import publisher from '../../../../gcloudPub';
import {
  sendNFTBookPendingClaimEmail,
  sendNFTBookSalesEmail,
  sendNFTBookClaimedEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookPhysicalOnlyEmail,
} from '../../../../ses';
import { sendNFTBookSalesSlackNotification } from '../../../../slack';
import { getBookCollectionInfoById } from '../../collection/book';
import { createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../../airtable';

export async function createNewNFTBookCollectionPayment(collectionId, paymentId, {
  type,
  priceInDecimal,
  originalPriceInDecimal,
  coupon,
  quantity = 1,
  email = '',
  claimToken,
  sessionId = '',
  from = '',
  isPhysicalOnly = false,
  giftInfo,
  itemPrices,
  feeInfo,
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  priceInDecimal: number,
  originalPriceInDecimal: number,
  coupon?: string,
  quantity?: number
  from?: string;
  isPhysicalOnly?: boolean,
  giftInfo?: {
    toName: string,
    toEmail: string,
    fromName: string,
    message?: string,
  };
  itemPrices?: any[],
  feeInfo?: TransactionFeeInfo,
}) {
  const docData = await getBookCollectionInfoById(collectionId);
  const { classIds } = docData;
  const payload: any = {
    type,
    email,
    isPaid: false,
    isPendingClaim: false,
    isPhysicalOnly,
    claimToken,
    sessionId,
    collectionId,
    classIds,
    priceInDecimal,
    originalPriceInDecimal,
    price: priceInDecimal / 100,
    quantity,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  };
  if (itemPrices) payload.itemPrices = itemPrices;
  if (feeInfo) payload.feeInfo = feeInfo;
  if (coupon) payload.coupon = coupon;

  const isGift = !!giftInfo;

  if (isGift) {
    const {
      toEmail = '',
      toName = '',
      fromName = '',
      message = '',
    } = giftInfo;
    payload.isGift = true;
    payload.giftInfo = {
      toEmail,
      toName,
      fromName,
      message,
    };
  }
  await likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).create(payload);
}

async function processNFTBookCollectionPurchaseTxGet(t, collectionId, paymentId, {
  email,
  phone,
  hasShipping,
  shippingDetails,
  shippingCost,
  execGrantTxHash,
}) {
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  const doc = await t.get(collectionRef);
  const docData = doc.data();
  if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
  const { typePayload } = docData;
  const { stock } = typePayload;
  const paymentDoc = await t.get(collectionRef.collection('transactions').doc(paymentId));
  const paymentData = paymentDoc.data();
  if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
  const { quantity, status } = paymentData;
  if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_CLAIMED');
  if (stock - quantity < 0) throw new ValidationError('OUT_OF_STOCK');
  typePayload.stock -= quantity;
  typePayload.sold += quantity;
  typePayload.lastSaleTimestamp = firestore.Timestamp.now();
  const paymentPayload: any = {
    isPaid: true,
    isPendingClaim: true,
    hasShipping,
    status: 'paid',
    email,
  };
  if (phone) paymentPayload.phone = phone;
  if (hasShipping) paymentPayload.shippingStatus = 'pending';
  if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
  if (shippingCost) paymentPayload.shippingCost = shippingCost.amount_total / 100;
  if (execGrantTxHash) paymentPayload.execGrantTxHash = execGrantTxHash;
  return {
    listingData: docData,
    typePayload,
    txData: {
      ...paymentData,
      ...paymentPayload,
    },
  };
}

async function processNFTBookCollectionPurchaseTxUpdate(t, collectionId, paymentId, {
  listingData,
  typePayload,
  txData,
}) {
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  t.update(collectionRef, {
    typePayload,
  });
  t.update(collectionRef.collection('transactions').doc(paymentId), txData);
  return {
    listingData,
    typePayload,
    txData,
  };
}

export async function processNFTBookCollectionPurchase({
  collectionId,
  email,
  phone,
  paymentId,
  shippingDetails,
  shippingCost,
  execGrantTxHash = '',
}) {
  const hasShipping = !!shippingDetails;
  const { listingData, txData } = await db.runTransaction(async (t) => {
    const data = await processNFTBookCollectionPurchaseTxGet(t, collectionId, paymentId, {
      email,
      phone,
      hasShipping,
      shippingDetails,
      shippingCost,
      execGrantTxHash,
    });
    await processNFTBookCollectionPurchaseTxUpdate(t, collectionId, paymentId, data);
    return {
      listingData: { ...data.listingData, ...data.typePayload },
      txData: data.txData,
    };
  });
  return { listingData, txData };
}

export async function handleNewNFTBookCollectionStripeCheckout(collectionId: string, {
  gaClientId,
  gaSessionId,
  from: inputFrom,
  quantity = 1,
  giftInfo,
  coupon,
  customPriceInDecimal,
  email,
  utm,
}: {
  gaClientId?: string,
  gaSessionId?: string,
  from?: string,
  email?: string,
  coupon?: string,
  quantity?: number,
  customPriceInDecimal?: number,
  giftInfo?: {
    toEmail: string,
    toName: string,
    fromName: string,
    message?: string,
  },
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
  },
} = {}) {
  const collectionData = await getBookCollectionInfoById(collectionId);
  if (!collectionData) throw new ValidationError('NFT_NOT_FOUND');
  const { classIds } = collectionData;
  let {
    image,
  } = collectionData;

  const paymentId = uuidv4();
  const claimToken = crypto.randomBytes(32).toString('hex');
  const {
    successUrl = giftInfo ? getLikerLandNFTGiftPageURL({
      collectionId,
      paymentId,
      type: 'nft_book',
      redirect: true,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    }) : getLikerLandNFTClaimPageURL({
      collectionId,
      paymentId,
      token: claimToken,
      type: 'nft_book',
      redirect: true,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    }),
    cancelUrl = getLikerLandNFTCollectionPageURL({
      collectionId,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    }),
    ownerWallet,
    shippingRates,
    isPhysicalOnly,
    defaultPaymentCurrency = 'USD',
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
    priceInDecimal: originalPriceInDecimal,
    coupons,
    isAllowCustomPrice,
    stock,
    hasShipping,
    name: collectionNameObj,
    description: collectionDescriptionObj,
  } = collectionData;
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  let priceInDecimal = originalPriceInDecimal;

  let discount = 1;
  if (coupon) {
    discount = getCouponDiscountRate(coupons, coupon as string);
  }
  priceInDecimal = Math.round(priceInDecimal * discount);

  let customPriceDiffInDecimal = 0;
  if (isAllowCustomPrice
    && customPriceInDecimal
    && customPriceInDecimal > priceInDecimal
    && customPriceInDecimal <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL) {
    customPriceDiffInDecimal = customPriceInDecimal - priceInDecimal;
    priceInDecimal = customPriceInDecimal;
  }

  if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
  if (priceInDecimal === 0) {
    const freePurchaseUrl = getLikerLandNFTClaimPageURL({
      collectionId,
      paymentId: '',
      token: '',
      type: 'nft_book',
      free: true,
      redirect: false,
      from: from as string,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    });
    return { url: freePurchaseUrl };
  }
  image = parseImageURLFromMetadata(image);
  let name = typeof collectionNameObj === 'object' ? collectionNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionNameObj || '';
  let description = typeof collectionDescriptionObj === 'object' ? collectionDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionDescriptionObj || '';
  name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
  if (from) description = `[${from}] ${description}`;
  description = description.length > 300
    ? `${description.substring(0, 299)}…`
    : description;
  if (!description) {
    description = undefined;
  } // stripe does not like empty string

  const classDataList = await Promise.all(classIds.map((id) => getNFTClassDataById(id)));

  const images: string[] = [];
  if (image) images.push(parseImageURLFromMetadata(image));
  classDataList.forEach((data) => {
    if (data?.data?.metadata?.image) {
      images.push(parseImageURLFromMetadata(data.data.metadata.image));
    }
  });

  const {
    session,
    itemPrices,
    feeInfo,
  } = await formatStripeCheckoutSession({
    collectionId,
    paymentId,
    from,
    gaClientId,
    gaSessionId,
    email,
    giftInfo,
    utm,
  }, [{
    name,
    description,
    images,
    quantity,
    priceInDecimal,
    customPriceDiffInDecimal,
    isLikerLandArt,
    ownerWallet,
    collectionId,
  }], {
    hasShipping,
    shippingRates,
    defaultPaymentCurrency,
    successUrl,
    cancelUrl,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookCollectionPayment(collectionId, paymentId, {
    type: 'stripe',
    priceInDecimal,
    originalPriceInDecimal,
    coupon,
    quantity,
    claimToken,
    sessionId,
    from: from as string,
    isPhysicalOnly,
    giftInfo,
    itemPrices,
    feeInfo,
  });

  return {
    url,
    paymentId,
    name,
    priceInDecimal,
    originalPriceInDecimal,
    customPriceDiffInDecimal,
    sessionId,
  };
}

export async function sendNFTBookCollectionPurchaseEmail({
  email,
  notificationEmails,
  collectionId,
  collectionName,
  paymentId,
  claimToken,
  amountTotal,
  mustClaimToView = false,
  isGift = false,
  giftInfo = null,
  isPhysicalOnly = false,
  phone = '',
  shippingDetails,
  shippingCost = 0,
  originalPrice = amountTotal,
  from,
}) {
  if (isPhysicalOnly) {
    await sendNFTBookPhysicalOnlyEmail({
      email,
      collectionId,
      bookName: collectionName,
    });
  } else if (isGift && giftInfo) {
    const {
      fromName,
      toName,
      toEmail,
      message,
    } = giftInfo;
    await sendNFTBookGiftPendingClaimEmail({
      fromName,
      toName,
      toEmail,
      message,
      collectionId,
      bookName: collectionName,
      paymentId,
      claimToken,
      mustClaimToView,
    });
  } else if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      collectionId,
      bookName: collectionName,
      paymentId,
      claimToken,
      mustClaimToView,
      from,
    });
  }
  await sendNFTBookSalesEmail({
    buyerEmail: email,
    emails: notificationEmails,
    bookName: collectionName,
    isGift,
    giftToEmail: (giftInfo as any)?.toEmail,
    giftToName: (giftInfo as any)?.toName,
    amount: amountTotal,
    phone,
    shippingDetails,
    shippingCost,
    originalPrice,
  });
}

export async function processNFTBookCollectionStripePurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    metadata: {
      collectionId,
      paymentId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
    shipping_details: shippingDetails,
    shipping_cost: shippingCost,
  } = session;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email, phone } = customer;
  try {
    const { txData, listingData } = await processNFTBookCollectionPurchase({
      collectionId,
      email,
      phone,
      paymentId,
      shippingDetails,
      shippingCost,
    });
    const {
      notificationEmails = [],
      defaultPaymentCurrency = 'USD',
      connectedWallets,
      ownerWallet,
    } = listingData;
    const {
      claimToken,
      price,
      type,
      from,
      isGift,
      giftInfo,
      isPhysicalOnly,
      originalPriceInDecimal,
      feeInfo,
      quantity,
    } = txData;
    const {
      stripeFeeAmount,
      likerLandFeeAmount,
      likerLandTipFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
    } = feeInfo;
    const [capturedPaymentIntent, collectionData] = await Promise.all([
      stripe.paymentIntents.capture(paymentIntent as string, {
        expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
      }),
      getBookCollectionInfoById(collectionId),
    ]);

    const balanceTx = (capturedPaymentIntent.latest_charge as Stripe.Charge)
      ?.balance_transaction as Stripe.BalanceTransaction;
    const currency = capturedPaymentIntent.currency || defaultPaymentCurrency;
    const exchangeRate = balanceTx?.exchange_rate
      || (currency.toLowerCase() === 'hkd' ? 1 / USD_TO_HKD_RATIO : 1);
    const chargeId = typeof capturedPaymentIntent.latest_charge === 'string' ? capturedPaymentIntent.latest_charge : capturedPaymentIntent.latest_charge?.id;
    const collectionName = collectionData?.name[NFT_BOOK_TEXT_DEFAULT_LOCALE] || collectionId;

    const { transfers } = await handleStripeConnectedAccount(
      {
        collectionId,
        paymentId,
        ownerWallet,
        bookName: collectionName,
      },
      {
        amountTotal,
        chargeId,
        currency,
        exchangeRate,
        stripeFeeAmount,
        likerLandFeeAmount,
        likerLandTipFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      },
      { connectedWallets, from },
    );

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseCaptured',
      type,
      paymentId,
      collectionId,
      price,
      fromChannel: from,
      sessionId: session.id,
      isGift,
    });

    const shippingCostAmount = shippingCost ? shippingCost.amount_total / 100 : 0;
    await Promise.all([
      sendNFTBookCollectionPurchaseEmail({
        email,
        notificationEmails,
        isGift,
        giftInfo,
        collectionId,
        collectionName,
        paymentId,
        claimToken,
        amountTotal: (amountTotal || 0) / 100,
        isPhysicalOnly,
        phone: phone || '',
        shippingDetails,
        shippingCost: shippingCostAmount,
        originalPrice: originalPriceInDecimal / 100,
        from,
      }),
      sendNFTBookSalesSlackNotification({
        collectionId,
        bookName: collectionName,
        paymentId,
        email,
        priceName: collectionName,
        priceWithCurrency: `${price} ${defaultPaymentCurrency || 'USD'}`,
        method: 'USD',
        from,
      }),
      createAirtableBookSalesRecordFromStripePaymentIntent({
        pi: capturedPaymentIntent,
        feeInfo,
        quantity,
        transfers,
        shippingCountry: shippingDetails?.address?.country,
        shippingCost: shippingCostAmount,
      }),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseError',
      type: 'stripe',
      paymentId,
      collectionId,
      error: (err as Error).toString(),
      errorMessage,
      errorStack,
    });
    await likeNFTCollectionCollection.doc(collectionId).collection('transactions')
      .doc(paymentId).update({
        status: 'canceled',
        email,
      });
    await stripe.paymentIntents.cancel(paymentIntent as string)
      .catch((error) => console.error(error)); // eslint-disable-line no-console
  }
}

export async function claimNFTBookCollection(
  collectionId: string,
  paymentId: string,
  { message, wallet, token }: { message: string, wallet: string, token: string },
) {
  const bookRef = likeNFTCollectionCollection.doc(collectionId);
  const docRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);
  const { email } = await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) {
      throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
    }
    const {
      claimToken,
      status,
    } = docData;
    if (token !== claimToken) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }
    if (status !== 'paid') {
      throw new ValidationError('PAYMENT_ALREADY_CLAIMED', 409);
    }
    t.update(docRef, {
      isPendingClaim: false,
      status: 'pendingNFT',
      wallet,
      message: message || '',
    });
    t.update(bookRef, {
      'typePayload.pendingNFTCount': FieldValue.increment(1),
    });
    return docData;
  });
  return email;
}

export async function sendNFTBookCollectionClaimedEmailNotification(
  collectionId: string,
  paymentId: string,
  {
    message, wallet, email, isGift, giftInfo,
  }
  : {
      message: string, wallet: string, email: string, isGift?: boolean, giftInfo?: {
      fromName: string,
      toName: string,
      toEmail: string,
      message?: string,
    }
  },
) {
  const docData = await getBookCollectionInfoById(collectionId);
  if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
  const { notificationEmails = [], name } = docData;
  if (notificationEmails.length) {
    await sendNFTBookClaimedEmail({
      emails: notificationEmails,
      collectionId,
      bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
      paymentId,
      wallet,
      claimerEmail: email,
      message,
    });
  }
  if (isGift && giftInfo) {
    const {
      fromName,
      toName,
    } = giftInfo;
    await sendNFTBookGiftClaimedEmail({
      bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
      fromEmail: email,
      fromName,
      toName,
    });
  }
}
