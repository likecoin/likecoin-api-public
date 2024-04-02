import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Query } from '@google-cloud/firestore';

import { formatMsgExecSendAuthorization } from '@likecoin/iscn-js/dist/messages/authz';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import BigNumber from 'bignumber.js';
import { NFT_BOOK_TEXT_DEFAULT_LOCALE, getNftBookInfo } from '.';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { ValidationError } from '../../../ValidationError';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL, getLikerLandNFTGiftPageURL } from '../../../liker-land';
import {
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  NFT_BOOK_SALE_DESCRIPTION,
  USD_TO_HKD_RATIO,
  LIST_OF_BOOK_SHIPPING_COUNTRY,
  PUBSUB_TOPIC_MISC,
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
} from '../../../../constant';
import { parseImageURLFromMetadata } from '../metadata';
import { calculateStripeFee, checkIsFromLikerLand, handleNFTPurchaseTransaction } from '../purchase';
import { getStripeConnectAccountId } from './user';
import stripe from '../../../stripe';
import { likeNFTBookCollection, FieldValue, db } from '../../../firebase';
import publisher from '../../../gcloudPub';
import { calculateTxGasFee } from '../../../cosmos/tx';
import { sendNFTBookSalesSlackNotification } from '../../../slack';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_TARGET_ADDRESS,
  LIKER_NFT_FEE_ADDRESS,
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
} from '../../../../../config/config';
import {
  sendNFTBookPendingClaimEmail,
  sendNFTBookSalesEmail,
  sendNFTBookClaimedEmail,
  sendNFTBookPhysicalOnlyEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftSentEmail,
} from '../../../ses';

export async function createNewNFTBookPayment(classId, paymentId, {
  type,
  email = '',
  claimToken,
  sessionId = '',
  priceInDecimal,
  originalPriceInDecimal,
  coupon,
  priceName,
  priceIndex,
  giftInfo,
  from = '',
  isPhysicalOnly = false,
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  priceInDecimal: number,
  originalPriceInDecimal: number,
  coupon?: string,
  priceName: string;
  priceIndex: number;
  from?: string;
  isPhysicalOnly?: boolean,
  giftInfo?: {
    toName: string,
    toEmail: string,
    fromName: string,
    message?: string,
  };
}) {
  const payload: any = {
    type,
    email,
    isPaid: false,
    isPendingClaim: false,
    isPhysicalOnly,
    claimToken,
    sessionId,
    classId,
    priceInDecimal,
    originalPriceInDecimal,
    price: priceInDecimal / 100,
    priceName,
    priceIndex,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  };
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
  await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).create(payload);
}

export async function processNFTBookPurchase({
  classId,
  email,
  paymentId,
  shippingDetails,
  shippingCost,
  execGrantTxHash = '',
}) {
  const hasShipping = !!shippingDetails;
  const { listingData, txData } = await db.runTransaction(async (t) => {
    const bookRef = likeNFTBookCollection.doc(classId);
    const doc = await t.get(bookRef);
    const docData = doc.data();
    if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const paymentDoc = await t.get(bookRef.collection('transactions').doc(paymentId));
    const paymentData = paymentDoc.data();
    if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
    const { status, priceIndex } = paymentData;
    if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_CLAIMED');
    const {
      prices,
    } = docData;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('NFT_PRICE_NOT_FOUND');
    const {
      stock,
      isAutoDeliver,
      autoMemo = '',
    } = priceInfo;
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
    priceInfo.stock -= 1;
    priceInfo.sold += 1;
    priceInfo.lastSaleTimestamp = firestore.Timestamp.now();
    const paymentPayload: any = {
      isPaid: true,
      isPendingClaim: true,
      hasShipping,
      status: 'paid',
      email,
    };
    if (isAutoDeliver) {
      const nftRes = await t.get(bookRef
        .collection('nft')
        .where('isSold', '==', false)
        .where('isProcessing', '==', false)
        .limit(1));
      if (!nftRes.size) throw new ValidationError('UNSOLD_NFT_BOOK_NOT_FOUND');
      const { id: nftId } = nftRes.docs[0];
      t.update(bookRef.collection('nft').doc(nftId), { isProcessing: true });
      paymentPayload.isAutoDeliver = true;
      paymentPayload.autoMemo = autoMemo;
      paymentPayload.nftId = nftId;
    }
    if (hasShipping) paymentPayload.shippingStatus = 'pending';
    if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
    if (shippingCost) paymentPayload.shippingCost = shippingCost.amount_total / 100;
    if (execGrantTxHash) paymentPayload.execGrantTxHash = execGrantTxHash;
    t.update(bookRef.collection('transactions').doc(paymentId), paymentPayload);
    t.update(bookRef, {
      prices,
      lastSaleTimestamp: FieldValue.serverTimestamp(),
    });
    const updatedPaymentData = { ...paymentData, ...paymentPayload };
    return {
      listingData: docData,
      txData: updatedPaymentData,
    };
  });
  return { listingData, txData };
}

function convertUSDToCurrency(usdPriceInDecimal: number, currency: string) {
  switch (currency) {
    case 'USD':
      return usdPriceInDecimal;
    case 'HKD':
      return Math.round((usdPriceInDecimal * USD_TO_HKD_RATIO) / 10) * 10;
    default:
      throw new ValidationError(`INVALID_CURRENCY_'${currency}'`);
  }
}

export function getCouponDiscountRate(coupons, couponCode: string) {
  let discount = 1;
  if (coupons?.[couponCode]) {
    const activeCoupon = coupons?.[couponCode];
    const { discount: couponDiscount, expireTs } = activeCoupon;
    if (!expireTs || Date.now() <= expireTs) {
      discount = couponDiscount;
    }
  }
  return discount;
}

export async function formatStripeCheckoutSession({
  classId,
  iscnPrefix,
  collectionId,
  paymentId,
  priceIndex,
  ownerWallet,
  email,
  from,
  gaClientId,
  gaSessionId,
  giftInfo,
  utm,
  httpMethod,
}: {
  classId?: string,
  iscnPrefix?: string,
  collectionId?: string,
  priceIndex?: number,
  paymentId: string,
  ownerWallet: string,
  email?: string,
  from?: string,
  gaClientId?: string,
  gaSessionId?: string,
  giftInfo?: {
    fromName: string,
    toName: string,
    toEmail: string,
    message?: string,
  },
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
  },
  httpMethod?: 'GET' | 'POST',
}, {
  name,
  description,
  images,
}: {
  name: string,
  description: string,
  images: string[],
}, {
  hasShipping,
  shippingRates,
  defaultPaymentCurrency,
  priceInDecimal,
  customPriceDiffInDecimal,
  connectedWallets,
  isLikerLandArt,
  successUrl,
  cancelUrl,
}: {
  hasShipping: boolean,
  shippingRates: any[],
  defaultPaymentCurrency: string,
  priceInDecimal: number,
  customPriceDiffInDecimal?: number,
  connectedWallets: string[],
  isLikerLandArt: boolean,
  successUrl: string,
  cancelUrl: string,
}) {
  const sessionMetadata: Stripe.MetadataParam = {
    store: 'book',
    paymentId,
    ownerWallet,
  };
  if (classId) sessionMetadata.classId = classId;
  if (iscnPrefix) sessionMetadata.iscnPrefix = iscnPrefix;
  if (priceIndex !== undefined) sessionMetadata.priceIndex = priceIndex.toString();
  if (collectionId) sessionMetadata.collectionId = collectionId;
  if (gaClientId) sessionMetadata.gaClientId = gaClientId;
  if (gaSessionId) sessionMetadata.gaSessionId = gaSessionId;
  if (from) sessionMetadata.from = from;
  if (giftInfo) sessionMetadata.giftInfo = giftInfo.toEmail;
  if (utm?.campaign) sessionMetadata.utmCampaign = utm.campaign;
  if (utm?.source) sessionMetadata.utmSource = utm.source;
  if (utm?.medium) sessionMetadata.utmMedium = utm.medium;
  if (httpMethod) sessionMetadata.httpMethod = httpMethod;

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    capture_method: 'manual',
    metadata: sessionMetadata,
  };

  const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
  const convertedPriceInDecimal = convertUSDToCurrency(priceInDecimal, convertedCurrency);
  const convertedCustomPriceDiffInDecimal = customPriceDiffInDecimal
    ? convertUSDToCurrency(customPriceDiffInDecimal, convertedCurrency) : 0;
  const convertedOriginalPriceInDecimal = convertedPriceInDecimal
    - convertedCustomPriceDiffInDecimal;

  const isFromLikerLand = checkIsFromLikerLand(from);
  const stripeFeeAmount = calculateStripeFee(convertedPriceInDecimal, convertedCurrency);
  const likerLandFeeAmount = Math.ceil(
    convertedOriginalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
  );
  const likerLandTipFeeAmount = Math.ceil(
    convertedCustomPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  );
  const likerLandCommission = isFromLikerLand
    ? Math.ceil(convertedOriginalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
    : 0;
  const likerlandArtFee = isLikerLandArt
    ? Math.ceil(convertedOriginalPriceInDecimal * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO)
    : 0;

  paymentIntentData.metadata = {
    ...paymentIntentData.metadata,
    stripeFeeAmount,
    likerLandTipFeeAmount,
    likerLandFeeAmount,
    likerLandCommission,
    likerlandArtFee,
  };

  if (customPriceDiffInDecimal) {
    paymentIntentData.metadata.customPriceDiff = customPriceDiffInDecimal;
  }

  if (connectedWallets && Object.keys(connectedWallets).length) {
    const wallet = Object.keys(connectedWallets)[0];
    const stripeConnectAccountId = await getStripeConnectAccountId(wallet);
    if (stripeConnectAccountId) {
      // TODO: support connectedWallets +1
      paymentIntentData.application_fee_amount = (
        stripeFeeAmount
          + likerLandFeeAmount
          + likerLandCommission
          + likerlandArtFee
          + likerLandTipFeeAmount
      );
      paymentIntentData.transfer_data = {
        destination: stripeConnectAccountId,
      };
    }
  }

  const productMetadata: Stripe.MetadataParam = {};
  if (classId) productMetadata.classId = classId;
  if (iscnPrefix) productMetadata.iscnPrefix = iscnPrefix;
  if (collectionId) productMetadata.collectionId = collectionId;

  const productData = {
    name,
    description,
    images,
    metadata: productMetadata,
  };

  const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    success_url: `${successUrl}`,
    cancel_url: `${cancelUrl}`,
    line_items: [
      {
        price_data: {
          currency: convertedCurrency,
          product_data: productData,
          unit_amount: convertedPriceInDecimal - convertedCustomPriceDiffInDecimal,
        },
        adjustable_quantity: {
          enabled: false,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: paymentIntentData,
    metadata: sessionMetadata,
  };
  if (convertedCustomPriceDiffInDecimal) {
    checkoutPayload.line_items?.push({
      price_data: {
        currency: convertedCurrency,
        product_data: {
          name: 'Extra Tip',
          description: 'Fund will be distributed to stakeholders and creators',
        },
        unit_amount: convertedCustomPriceDiffInDecimal,
      },
      quantity: 1,
    });
  }
  if (email) checkoutPayload.customer_email = email;
  if (hasShipping) {
    checkoutPayload.shipping_address_collection = {
      // eslint-disable-next-line max-len
      allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
    if (shippingRates) {
      checkoutPayload.shipping_options = shippingRates
        .filter((s) => s?.name && s?.priceInDecimal >= 0)
        .map((s) => {
          const { name: shippingName, priceInDecimal: shippingPriceInDecimal } = s;
          const convertedShippingPriceInDecimal = (
            convertUSDToCurrency(shippingPriceInDecimal, convertedCurrency)
          );
          return {
            shipping_rate_data: {
              display_name: shippingName[NFT_BOOK_TEXT_DEFAULT_LOCALE],
              type: 'fixed_amount',
              fixed_amount: {
                amount: convertedShippingPriceInDecimal,
                currency: convertedCurrency,
              },
            },
          };
        });
    }
  }
  const session = await stripe.checkout.sessions.create(checkoutPayload);
  return session;
}

export async function handleNewStripeCheckout(classId: string, priceIndex: number, {
  gaClientId,
  gaSessionId,
  from: inputFrom,
  coupon,
  customPriceInDecimal,
  email,
  giftInfo,
  utm,
  httpMethod,
}: {
  httpMethod?: 'GET' | 'POST',
  gaClientId?: string,
  gaSessionId?: string,
  email?: string,
  from?: string,
  coupon?: string,
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
  const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
  const [metadata, bookInfo] = (await Promise.all(promises)) as any;
  if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');

  const paymentId = uuidv4();
  const claimToken = crypto.randomBytes(32).toString('hex');
  const {
    prices,
    successUrl = giftInfo ? getLikerLandNFTGiftPageURL({
      classId,
      paymentId,
      type: 'nft_book',
      redirect: true,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    }) : getLikerLandNFTClaimPageURL({
      classId,
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
    cancelUrl = getLikerLandNFTClassPageURL({
      classId,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    }),
    ownerWallet,
    connectedWallets,
    shippingRates,
    defaultPaymentCurrency = 'USD',
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
    coupons,
  } = bookInfo;
  if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  const {
    priceInDecimal: originalPriceInDecimal,
    stock,
    hasShipping,
    isPhysicalOnly,
    isAllowCustomPrice,
    name: priceNameObj,
    description: pricDescriptionObj,
  } = prices[priceIndex];

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
      classId,
      paymentId: '',
      token: '',
      type: 'nft_book',
      free: true,
      redirect: false,
      priceIndex,
      from: from as string,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
    });
    return { url: freePurchaseUrl };
  }
  let { name = '', description = '' } = metadata;
  const classMetadata = metadata.data.metadata;
  const iscnPrefix = metadata.data.parent.iscnIdPrefix || undefined;
  let { image } = classMetadata;
  image = parseImageURLFromMetadata(image);
  name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
  const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
  const priceDescription = typeof pricDescriptionObj === 'object' ? pricDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : pricDescriptionObj || '';
  if (priceName) {
    name = `${name} - ${priceName}`;
  }
  if (NFT_BOOK_SALE_DESCRIPTION[classId]) {
    description = NFT_BOOK_SALE_DESCRIPTION[classId];
  } else if (priceDescription) {
    description = `${description} - ${priceDescription}`;
  }

  if (from) description = `[${from}] ${description}`;
  description = description.length > 300
    ? `${description.substring(0, 299)}…`
    : description;
  if (!description) {
    description = undefined;
  } // stripe does not like empty string

  const session = await formatStripeCheckoutSession({
    classId,
    iscnPrefix,
    paymentId,
    priceIndex,
    ownerWallet,
    from,
    gaClientId,
    gaSessionId,
    email,
    giftInfo,
    utm,
    httpMethod,
  }, {
    name,
    description,
    images: image ? [image] : [],
  }, {
    hasShipping,
    shippingRates,
    defaultPaymentCurrency,
    priceInDecimal,
    customPriceDiffInDecimal,
    connectedWallets,
    isLikerLandArt,
    successUrl,
    cancelUrl,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookPayment(classId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    priceInDecimal,
    originalPriceInDecimal,
    coupon,
    priceName,
    priceIndex,
    giftInfo,
    isPhysicalOnly,
    from: from as string,
  });

  return {
    url,
    paymentId,
    priceName,
    priceInDecimal,
    customPriceDiffInDecimal,
    originalPriceInDecimal,
    sessionId,
  };
}

export async function sendNFTBookPurchaseEmail({
  email,
  notificationEmails,
  classId = '',
  collectionId = '',
  bookName,
  priceName,
  paymentId,
  claimToken,
  amountTotal,
  isGift = false,
  giftInfo,
  mustClaimToView = false,
  isPhysicalOnly = false,
}) {
  if (isPhysicalOnly) {
    await sendNFTBookPhysicalOnlyEmail({
      email,
      classId,
      bookName,
      priceName,
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
      classId,
      collectionId,
      bookName,
      paymentId,
      claimToken,
      mustClaimToView,
    });
  } else if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      classId,
      collectionId,
      bookName,
      paymentId,
      claimToken,
      mustClaimToView,
    });
  }
  if (notificationEmails) {
    await sendNFTBookSalesEmail({
      buyerEmail: email,
      isGift,
      giftToEmail: (giftInfo as any)?.toEmail,
      giftToName: (giftInfo as any)?.toName,
      emails: notificationEmails,
      bookName,
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
      shippingDetails,
      shippingCost,
    });
    const {
      notificationEmails = [],
      mustClaimToView = false,
      defaultPaymentCurrency,
    } = listingData;
    const {
      claimToken, price, priceName, type, from, isGift, giftInfo, isPhysicalOnly,
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
      isGift,
    });

    const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
    const convertedPriceInDecimal = convertUSDToCurrency(price, convertedCurrency);
    const className = classData?.name || classId;
    await Promise.all([
      sendNFTBookPurchaseEmail({
        email,
        isGift,
        giftInfo,
        notificationEmails,
        classId,
        bookName: className,
        priceName,
        paymentId,
        claimToken,
        amountTotal,
        mustClaimToView,
        isPhysicalOnly,
      }),
      sendNFTBookSalesSlackNotification({
        classId,
        bookName: className,
        paymentId,
        email,
        priceName,
        priceWithCurrency: `${convertedPriceInDecimal} ${convertedCurrency}`,
        method: 'Fiat',
        from,
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

export async function claimNFTBook(
  classId: string,
  paymentId: string,
  { message, wallet, token }: { message: string, wallet: string, token: string },
  req,
) {
  const bookRef = likeNFTBookCollection.doc(classId);
  const docRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);
  const {
    email,
    isAutoDeliver,
    nftId,
    autoMemo = '',
  } = await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) {
      throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
    }
    const {
      claimToken,
      isPhysicalOnly,
      status,
    } = docData;
    if (token !== claimToken) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }
    if (status !== 'paid') {
      throw new ValidationError('PAYMENT_ALREADY_CLAIMED', 409);
    }
    if (isPhysicalOnly) {
      throw new ValidationError('CANNOT_CLAIM_PHYSICAL_ONLY', 409);
    }
    t.update(docRef, {
      status: 'pendingNFT',
      wallet,
      message: message || '',
    });
    if (!docData.isAutoDeliver) {
      t.update(bookRef, {
        pendingNFTCount: FieldValue.increment(1),
      });
    }
    return docData;
  });

  if (isAutoDeliver) {
    let txHash = '';
    try {
      const txMessages = [formatMsgSend(LIKER_NFT_TARGET_ADDRESS, wallet, classId, nftId)];
      txHash = await handleNFTPurchaseTransaction(txMessages, autoMemo);
    } catch (autoDeliverErr) {
      await docRef.update({
        status: 'paid',
        wallet: '',
        message: '',
      });
      throw autoDeliverErr;
    }

    const { isGift, giftInfo } = await db.runTransaction(async (t) => {
      // eslint-disable-next-line no-use-before-define
      const paymentDocData = await updateNFTBookPostDeliveryData({
        classId,
        callerWallet: LIKER_NFT_TARGET_ADDRESS,
        paymentId,
        txHash,
        isAutoDeliver,
      }, t);
      t.update(bookRef.collection('nft').doc(nftId), {
        ownerWallet: wallet,
        isProcessing: false,
        isSold: true,
      });
      return paymentDocData;
    });

    if (isGift && giftInfo && email) {
      const {
        fromName,
        toName,
      } = giftInfo;
      const classData = await getNFTClassDataById(classId).catch(() => null);
      const className = classData?.name || classId;
      await sendNFTBookGiftSentEmail({
        fromEmail: email,
        fromName,
        toName,
        bookName: className,
        txHash,
      });
    }

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTSentUpdate',
      isAutoDeliver,
      paymentId,
      classId,
      nftId,
      txHash,
      isGift,
    });
  }

  return { email, nftId };
}

export async function sendNFTBookClaimedEmailNotification(
  classId: string,
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
  const bookRef = likeNFTBookCollection.doc(classId);
  const doc = await bookRef.get();
  const docData = doc.data();
  if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
  const { notificationEmails = [] } = docData;
  const classData = await getNFTClassDataById(classId).catch(() => null);
  const className = classData?.name || classId;
  if (notificationEmails && notificationEmails.length) {
    await sendNFTBookClaimedEmail({
      emails: notificationEmails,
      classId,
      bookName: className,
      paymentId,
      wallet,
      claimerEmail: giftInfo?.toEmail || email,
      message,
    });
  }
  if (isGift && giftInfo) {
    const {
      fromName,
      toName,
    } = giftInfo;
    if (email) {
      await sendNFTBookGiftClaimedEmail({
        bookName: className,
        fromEmail: email,
        fromName,
        toName,
      });
    }
  }
}

export async function updateNFTBookPostDeliveryData({
  classId,
  callerWallet,
  paymentId,
  txHash,
  isAutoDeliver = false,
}: {
  classId: string,
  callerWallet: string,
  paymentId: string,
  txHash: string,
  isAutoDeliver?: boolean,
}, t: any) {
  // TODO: check tx content contains valid nft info and address
  const bookDocRef = likeNFTBookCollection.doc(classId);
  const bookDoc = await t.get(bookDocRef);
  const bookDocData = bookDoc.data();
  if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
  const { ownerWallet, moderatorWallets = [] } = bookDocData;
  if (![ownerWallet, ...moderatorWallets, LIKER_NFT_TARGET_ADDRESS].includes(callerWallet)) {
    // TODO: check tx is sent by req.user.wallet
    throw new ValidationError('NOT_OWNER', 403);
  }
  const paymentDocRef = bookDocRef.collection('transactions').doc(paymentId);
  const paymentDoc = await t.get(paymentDocRef);
  const paymentDocData = paymentDoc.data();
  if (!paymentDocData) {
    throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
  }
  const { status, isPhysicalOnly } = paymentDocData;
  if (status !== 'pendingNFT') {
    throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
  }
  if (isPhysicalOnly) {
    throw new ValidationError('CANNOT_SEND_PHYSICAL_ONLY', 409);
  }
  t.update(paymentDocRef, {
    status: 'completed',
    txHash,
  });
  if (!isAutoDeliver) {
    t.update(bookDocRef, {
      pendingNFTCount: FieldValue.increment(-1),
    });
  }
  return paymentDocData;
}

export async function execGrant(
  granterWallet: string,
  toWallet: string,
  LIKEAmount: number,
  from: string,
) {
  const isFromLikerLand = checkIsFromLikerLand(from);
  const msgCount = 3;
  const gasFeeAmount = calculateTxGasFee(msgCount).amount[0].amount;
  const distributedAmountBigNum = new BigNumber(LIKEAmount).shiftedBy(9).minus(gasFeeAmount);
  if (distributedAmountBigNum.lt(0)) throw new ValidationError('LIKE_AMOUNT_IS_NOT_SUFFICIENT_FOR_GAS_FEE');
  const likerLandFeeAmount = distributedAmountBigNum
    .times(NFT_BOOK_LIKER_LAND_FEE_RATIO)
    .toFixed(0, BigNumber.ROUND_CEIL);
  const likerLandCommission = isFromLikerLand
    ? distributedAmountBigNum
      .times(NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
      .toFixed(0, BigNumber.ROUND_CEIL)
    : '0';
  const commissionAndFeeAmount = new BigNumber(likerLandFeeAmount)
    .plus(likerLandCommission)
    .toFixed();
  const profitAmount = distributedAmountBigNum
    .minus(likerLandFeeAmount)
    .minus(likerLandCommission)
    .toFixed();
  const txMessages = [
    formatMsgExecSendAuthorization(
      LIKER_NFT_TARGET_ADDRESS,
      granterWallet,
      LIKER_NFT_TARGET_ADDRESS,
      [{ denom: NFT_COSMOS_DENOM, amount: gasFeeAmount }],
    ),
    formatMsgExecSendAuthorization(
      LIKER_NFT_TARGET_ADDRESS,
      granterWallet,
      LIKER_NFT_FEE_ADDRESS,
      [{ denom: NFT_COSMOS_DENOM, amount: commissionAndFeeAmount }],
    ),
    formatMsgExecSendAuthorization(
      LIKER_NFT_TARGET_ADDRESS,
      granterWallet,
      toWallet,
      [{ denom: NFT_COSMOS_DENOM, amount: profitAmount }],
    ),
  ];
  const memo = '';
  const txHash = await handleNFTPurchaseTransaction(txMessages, memo);
  return txHash;
}
