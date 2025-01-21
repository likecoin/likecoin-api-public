import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';

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
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../../constant';
import { parseImageURLFromMetadata } from '../../metadata';
import {
  TransactionFeeInfo,
  calculateFeeAndDiscountFromBalanceTx,
  formatStripeCheckoutSession, handleStripeConnectedAccount,
} from '../purchase';
import { handleNFTPurchaseTransaction } from '../../purchase';
import stripe, { getStripePromotoionCodesFromCheckoutSession } from '../../../../stripe';
import { likeNFTCollectionCollection, FieldValue, db } from '../../../../firebase';
import publisher from '../../../../gcloudPub';
import {
  sendNFTBookPendingClaimEmail,
  sendNFTBookSalesEmail,
  sendNFTBookClaimedEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookPhysicalOnlyEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookOutOfStockEmail,
} from '../../../../ses';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../../slack';
import { getBookCollectionInfoById } from '../../collection/book';
import { createAirtableBookSalesRecordFromFreePurchase, createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../../airtable';

import {
  LIKER_NFT_TARGET_ADDRESS,
  SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD,
} from '../../../../../../config/config';
import { getReaderSegmentNameFromAuthorWallet, upsertCrispProfile } from '../../../../crisp';
import logPixelEvents from '../../../../fbq';
import { getBookUserInfoFromWallet } from '../user';

export async function createNewNFTBookCollectionPayment(collectionId, paymentId, {
  type,
  cartId,
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
  cartId?: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  priceInDecimal: number,
  originalPriceInDecimal: number,
  coupon?: string,
  quantity?: number,
  from?: string,
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
  if (cartId) payload.cartId = cartId;
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

export async function processNFTBookCollectionPurchaseTxGet(t, collectionId, paymentId, {
  email,
  phone,
  hasShipping,
  shippingDetails,
  shippingCostAmount,
  execGrantTxHash,
}) {
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  const doc = await t.get(collectionRef);
  const docData = doc.data();
  if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
  const { typePayload, classIds } = docData;
  const { stock, isAutoDeliver, autoMemo } = typePayload;
  const paymentDoc = await t.get(collectionRef.collection('transactions').doc(paymentId));
  const paymentData = paymentDoc.data();
  if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
  const { quantity, status } = paymentData;
  if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_PROCESSED');
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
  if (isAutoDeliver) {
    const nftIdMap = {};
    for (let i = 0; i < classIds.length; i += 1) {
      const classId = classIds[i];
      const nftRes = await t.get(collectionRef
        .collection('class')
        .doc(classId)
        .collection('nft')
        .where('isSold', '==', false)
        .where('isProcessing', '==', false)
        .limit(quantity));
      if (nftRes.size !== quantity) throw new ValidationError('UNSOLD_NFT_BOOK_NOT_FOUND');
      const nftIds = nftRes.docs.map((d) => d.id);
      nftIdMap[classId] = nftIds;
    }
    paymentPayload.isAutoDeliver = true;
    paymentPayload.autoMemo = autoMemo;
    paymentPayload.nftIdMap = nftIdMap;
  }
  if (phone) paymentPayload.phone = phone;
  if (hasShipping) paymentPayload.shippingStatus = 'pending';
  if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
  if (shippingCostAmount) paymentPayload.shippingCost = shippingCostAmount;
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

export async function processNFTBookCollectionPurchaseTxUpdate(t, collectionId, paymentId, {
  listingData,
  typePayload,
  txData,
}) {
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  t.update(collectionRef, {
    typePayload,
  });
  t.update(collectionRef.collection('transactions').doc(paymentId), txData);
  if (txData.nftIdMap) {
    Object.entries(txData.nftIdMap).forEach(([classId, nftIds]) => {
      (nftIds as string[]).forEach((nftId) => {
        t.update(collectionRef
          .collection('class')
          .doc(classId)
          .collection('nft')
          .doc(nftId), { isProcessing: true });
      });
    });
  }
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
  shippingCostAmount,
  execGrantTxHash = '',
}) {
  const hasShipping = !!shippingDetails;
  const { listingData, txData } = await db.runTransaction(async (t) => {
    const data = await processNFTBookCollectionPurchaseTxGet(t, collectionId, paymentId, {
      email,
      phone,
      hasShipping,
      shippingDetails,
      shippingCostAmount,
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
  gadClickId,
  gadSource,
  fbClickId,
  from: inputFrom,
  quantity = 1,
  giftInfo,
  coupon,
  customPriceInDecimal,
  likeWallet,
  email,
  utm,
  referrer,
  httpMethod,
  userAgent,
  clientIp,
}: {
  gaClientId?: string,
  gaSessionId?: string,
  gadClickId?: string,
  gadSource?: string,
  fbClickId?: string,
  likeWallet?: string,
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
  referrer?: string,
  httpMethod?: 'GET' | 'POST',
  userAgent?: string,
  clientIp?: string,
} = {}) {
  const collectionData = await getBookCollectionInfoById(collectionId);
  if (!collectionData) throw new ValidationError('NFT_NOT_FOUND');
  const { classIds } = collectionData;
  let {
    image,
  } = collectionData;

  let customerEmail = email;
  let customerId;
  if (likeWallet) {
    const res = await getBookUserInfoFromWallet(likeWallet);
    const { bookUserInfo, likerUserInfo } = res || {};
    const { email: userEmail, isEmailVerified } = likerUserInfo || {};
    customerId = bookUserInfo?.stripeCustomerId;
    customerEmail = isEmailVerified ? userEmail : email;
  }
  const paymentId = uuidv4();
  const claimToken = crypto.randomBytes(32).toString('hex');
  const {
    successUrl = giftInfo ? getLikerLandNFTGiftPageURL({
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
      gadClickId,
      gadSource,
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
      gadClickId,
      gadSource,
    }),
    cancelUrl = getLikerLandNFTCollectionPageURL({
      collectionId,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
    ownerWallet,
    shippingRates,
    isPhysicalOnly,
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
    priceInDecimal: originalPriceInDecimal,
    isAllowCustomPrice,
    stock,
    hasShipping,
    name: collectionNameObj,
    description: collectionDescriptionObj,
    stripePriceId,
  } = collectionData;
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  let priceInDecimal = originalPriceInDecimal;
  let customPriceDiffInDecimal = 0;
  if (isAllowCustomPrice
    && customPriceInDecimal
    && customPriceInDecimal > priceInDecimal
    && customPriceInDecimal <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL) {
    customPriceDiffInDecimal = customPriceInDecimal - priceInDecimal;
    priceInDecimal = customPriceInDecimal;
  }

  if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
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
    likeWallet,
    customerId,
    from,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    email: customerEmail,
    coupon,
    giftInfo,
    referrer,
    utm,
    httpMethod,
    userAgent,
    clientIp,
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
    stripePriceId,
  }], {
    hasShipping,
    shippingRates,
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
  shippingCostAmount = 0,
  originalPrice = amountTotal,
  quantity,
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
    });
  } else if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      collectionId,
      bookName: collectionName,
      paymentId,
      claimToken,
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
    quantity,
    phone,
    shippingDetails,
    shippingCostAmount,
    originalPrice,
  });
}

export async function updateNFTBookCollectionPostCheckoutFeeInfo({
  collectionId,
  paymentId,
  amountSubtotal,
  amountTotal,
  shippingCostAmount,
  sessionId,
  balanceTx,
  feeInfo,
  coupon: existingCoupon,
}) {
  if (!balanceTx) {
    return {
      ...feeInfo,
      coupon: existingCoupon,
      stripeFeeCurrency: '',
    };
  }
  const {
    isStripeFeeUpdated,
    isAmountFeeUpdated,
    stripeFeeCurrency,
    newFeeInfo,
  } = calculateFeeAndDiscountFromBalanceTx({
    paymentId,
    amountSubtotal,
    amountTotal,
    shippingCostAmount,
    balanceTx,
    feeInfo,
  });
  let coupon = existingCoupon;
  if (isAmountFeeUpdated) {
    [coupon = ''] = await getStripePromotoionCodesFromCheckoutSession(sessionId);
  }
  if (isStripeFeeUpdated || isAmountFeeUpdated) {
    const payload: any = {
      feeInfo: newFeeInfo,
      shippingCost: shippingCostAmount,
    };
    if (coupon) payload.coupon = coupon;
    await likeNFTCollectionCollection.doc(collectionId).collection('transactions')
      .doc(paymentId).update(payload);
  }
  return {
    ...newFeeInfo,
    coupon,
    stripeFeeCurrency,
  };
}

export async function processNFTBookCollectionStripePurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  let {
    amount_total: amountTotal,
    amount_subtotal: amountSubtotal,
  } = session;
  const {
    metadata: {
      collectionId,
      paymentId,
      userAgent,
      clientIp,
      referrer,
      fbClickId,
      utmSource,
      utmCampaign,
      utmMedium,
      gaClientId,
      gaSessionId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    shipping_details: shippingDetails,
    shipping_cost: shippingCost,
    currency_conversion: currencyConversion,
    id: sessionId,
  } = session;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');

  const isFree = amountTotal === 0;
  if (!isFree && !paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');

  const { email, phone } = customer;

  let shippingCostAmount = 0;
  if (shippingCost) {
    shippingCostAmount = shippingCost.amount_total / 100;
  }
  if (currencyConversion) {
    if (currencyConversion.amount_subtotal !== undefined) {
      amountSubtotal = currencyConversion.amount_subtotal;
    }
    if (currencyConversion.amount_total !== undefined) {
      amountTotal = currencyConversion.amount_total;
    }
    if (currencyConversion.fx_rate !== undefined && shippingCost?.amount_total) {
      shippingCostAmount = Math.round(
        shippingCost.amount_total / Number(currencyConversion.fx_rate),
      ) / 100;
    }
  }

  try {
    const { txData, listingData } = await processNFTBookCollectionPurchase({
      collectionId,
      email,
      phone,
      paymentId,
      shippingDetails,
      shippingCostAmount,
    });
    const {
      notificationEmails = [],
      connectedWallets,
      ownerWallet,
      typePayload,
    } = listingData;
    const {
      claimToken,
      price,
      type,
      from,
      isGift,
      giftInfo,
      isPhysicalOnly,
      feeInfo: docFeeInfo,
      quantity,
      coupon: docCoupon,
    } = txData;
    const [expandedPaymentIntent, collectionData] = await Promise.all([
      isFree ? null : stripe.paymentIntents.retrieve(paymentIntent as string, {
        expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
      }),
      getBookCollectionInfoById(collectionId),
    ]);

    let balanceTx: Stripe.BalanceTransaction | null = null;
    if (expandedPaymentIntent) {
      balanceTx = (expandedPaymentIntent.latest_charge as Stripe.Charge)
        ?.balance_transaction as Stripe.BalanceTransaction;
    }
    const {
      stripeFeeAmount,
      stripeFeeCurrency,
      likerLandFeeAmount,
      likerLandTipFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiff,
      coupon,
    } = await updateNFTBookCollectionPostCheckoutFeeInfo({
      collectionId,
      paymentId,
      amountSubtotal,
      amountTotal,
      sessionId,
      balanceTx,
      feeInfo: docFeeInfo,
      shippingCostAmount,
      coupon: docCoupon,
    });

    const feeInfo: TransactionFeeInfo = {
      stripeFeeAmount,
      likerLandFeeAmount,
      likerLandTipFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiff,
    };

    let chargeId: string | undefined;

    if (expandedPaymentIntent) {
      chargeId = typeof expandedPaymentIntent.latest_charge === 'string' ? expandedPaymentIntent.latest_charge : expandedPaymentIntent.latest_charge?.id;
    }
    const collectionName = collectionData?.name[NFT_BOOK_TEXT_DEFAULT_LOCALE] || collectionId;

    const { transfers } = await handleStripeConnectedAccount(
      {
        collectionId,
        paymentId,
        ownerWallet,
        bookName: collectionName,
        buyerEmail: email,
        paymentIntentId: paymentIntent as string,
        shippingCostAmount,
      },
      {
        amountTotal,
        chargeId,
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
      email,
      collectionId,
      price,
      customPriceDiff,
      coupon,
      quantity,
      fromChannel: from,
      sessionId: session.id,
      isGift,
    });

    const notifications: Promise<any>[] = [
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
        quantity,
        isPhysicalOnly,
        phone: phone || '',
        shippingDetails,
        shippingCostAmount,
        originalPrice: originalPriceInDecimal / 100,
        from,
      }),
      sendNFTBookSalesSlackNotification({
        collectionId,
        bookName: collectionName,
        paymentId,
        email,
        priceName: collectionName,
        priceWithCurrency: `${price} USD`,
        method: 'USD',
        from,
      }),
      expandedPaymentIntent ? createAirtableBookSalesRecordFromStripePaymentIntent({
        pi: expandedPaymentIntent,
        paymentId,
        collectionId,
        from,
        feeInfo,
        quantity,
        transfers,
        shippingCountry: shippingDetails?.address?.country,
        shippingCostAmount,
        stripeFeeCurrency,
        stripeFeeAmount,
        coupon,
        isGift,
      }) : createAirtableBookSalesRecordFromFreePurchase({
        collectionId,
        paymentId,
        quantity,
        from,
        email: email || undefined,
        utmSource,
        utmCampaign,
        utmMedium,
        referrer,
        gaClientId,
        gaSessionId,
      }),
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseComplete',
        type,
        paymentId,
        collectionId,
        price,
        customPriceDiff,
        quantity,
        email,
        fromChannel: from,
        sessionId: session.id,
        stripeFeeAmount,
        coupon,
        isGift,
      }),
    ];

    const stock = typePayload?.stock;
    const isOutOfStock = stock <= 0;
    if (stock <= SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD) {
      notifications.push(sendNFTBookOutOfStockSlackNotification({
        collectionId,
        className: collectionName,
        priceName: '',
        priceIndex: 0,
        notificationEmails,
        wallet: ownerWallet,
        stock,
      }));
    }
    if (isOutOfStock) {
      notifications.push(sendNFTBookOutOfStockEmail({
        emails: notificationEmails,
        collectionId,
        bookName: collectionName,
        priceName: '',
      // eslint-disable-next-line no-console
      }).catch((err) => console.error(err)));
    }
    await Promise.all(notifications);

    if (email) {
      const segments = isFree ? ['free book'] : ['purchaser'];
      if (feeInfo.customPriceDiff) segments.push('tipper');
      const readerSegment = getReaderSegmentNameFromAuthorWallet(ownerWallet);
      if (readerSegment) segments.push(readerSegment);
      try {
        await upsertCrispProfile(email, { segments });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }
    await logPixelEvents('Purchase', {
      email: email || '',
      items: [{
        productId: collectionId,
        quantity,
      }],
      userAgent,
      clientIp,
      value: (amountTotal || 0) / 100,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    if (errorMessage !== 'PAYMENT_ALREADY_PROCESSED') {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseError',
        type: 'stripe',
        paymentId,
        email,
        collectionId,
        error: (err as Error).toString(),
        errorMessage,
        errorStack,
      });
      await likeNFTCollectionCollection.doc(collectionId).collection('transactions')
        .doc(paymentId).update({
          status: 'error',
          email,
        });
    }
  }
}

export async function claimNFTBookCollection(
  collectionId: string,
  paymentId: string,
  {
    message,
    wallet,
    token,
    loginMethod,
  }: {
    message: string,
    wallet: string,
    token: string,
    loginMethod?: string,
  },
  req,
) {
  const bookRef = likeNFTCollectionCollection.doc(collectionId);
  const docRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);
  const {
    email, classIds, nftIdMap, isAutoDeliver, autoMemo, quantity,
  } = await db.runTransaction(async (t) => {
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
      loginMethod: loginMethod || '',
    });

    if (!docData.isAutoDeliver) {
      t.update(bookRef, {
        'typePayload.pendingNFTCount': FieldValue.increment(1),
      });
    }
    return docData;
  });

  let txHash = '';
  let autoSentNftIds: string[] | null = null;
  if (isAutoDeliver) {
    const txMessages: any[] = [];
    autoSentNftIds = [];
    try {
      // classId must be in order for autoMemo array to work
      classIds.forEach((classId) => {
        const nftIds: string[] = nftIdMap[classId];
        nftIds.forEach((nftId) => {
          txMessages.push(formatMsgSend(LIKER_NFT_TARGET_ADDRESS, wallet, classId, nftId));
        });
        autoSentNftIds = (autoSentNftIds as string[]).concat(nftIds as string[]);
      });
      txHash = await handleNFTPurchaseTransaction(txMessages, autoMemo);
    } catch (autoDeliverErr) {
      await docRef.update({
        isPendingClaim: true,
        status: 'paid',
        wallet: '',
        message: '',
        lastError: (autoDeliverErr as Error).toString(),
      });
      throw autoDeliverErr;
    }

    const { isGift, giftInfo, name } = await db.runTransaction(async (t) => {
      // eslint-disable-next-line no-use-before-define
      const paymentDocData = await updateNFTBookCollectionPostDeliveryData({
        collectionId,
        callerWallet: LIKER_NFT_TARGET_ADDRESS,
        paymentId,
        txHash,
        quantity,
        isAutoDeliver,
      }, t);
      Object.entries(nftIdMap).forEach(([classId, nftIds]) => {
        (nftIds as string[]).forEach((nftId) => {
          t.update(bookRef
            .collection('class')
            .doc(classId)
            .collection('nft')
            .doc(nftId), {
            ownerWallet: wallet,
            isProcessing: false,
            isSold: true,
          });
        });
      });
      return paymentDocData;
    });

    if (isGift && giftInfo) {
      const {
        fromName,
        toName,
      } = giftInfo;
      await sendNFTBookGiftSentEmail({
        fromEmail: email,
        fromName,
        toName,
        bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
        txHash,
      });
    }

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTSentUpdate',
      isAutoDeliver,
      paymentId,
      email,
      fromWallet: req.user?.wallet,
      toWallet: wallet,
      collectionId,
      txHash,
      isGift,
    });
  }
  return { email, nftIds: autoSentNftIds, txHash };
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

export async function updateNFTBookCollectionPostDeliveryData({
  collectionId,
  callerWallet,
  paymentId,
  txHash,
  quantity = 1,
  isAutoDeliver = false,
}: {
  collectionId: string,
  callerWallet: string,
  paymentId: string,
  txHash: string,
  quantity?: number,
  isAutoDeliver?: boolean,
}, t: any) {
  // TODO: check tx content contains valid nft info and address
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  const collectionDoc = await collectionRef.get();
  const collectionDocData = collectionDoc.data();
  if (!collectionDocData) throw new ValidationError('COLLECTION_ID_NOT_FOUND', 404);
  const { name, ownerWallet, moderatorWallets = [] } = collectionDocData;
  if (![ownerWallet, ...moderatorWallets, LIKER_NFT_TARGET_ADDRESS].includes(callerWallet)) {
    // TODO: check tx is sent by req.user.wallet
    throw new ValidationError('NOT_OWNER', 403);
  }
  const paymentDocRef = likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId);

  const doc = await t.get(paymentDocRef);
  const docData = doc.data();
  if (!docData) {
    throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
  }
  const {
    status,
    quantity: docQuantity = 1,
  } = docData;
  if (quantity !== docQuantity) {
    throw new ValidationError('INVALID_QUANTITY', 400);
  }
  if (status === 'completed') {
    throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
  }
  t.update(paymentDocRef, {
    status: 'completed',
    txHash,
  });
  if (status === 'pendingNFT' && !isAutoDeliver) {
    t.update(collectionRef, {
      'typePayload.pendingNFTCount': FieldValue.increment(-1),
    });
  }
  return {
    ...docData,
    name,
  };
}
