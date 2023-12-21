import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';

import { formatMsgExecSendAuthorization } from '@likecoin/iscn-js/dist/messages/authz';
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
} from '../../../../constant';
import { parseImageURLFromMetadata, encodedURL } from '../metadata';
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
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
} from '../../../../../config/config';
import {
  sendNFTBookPendingClaimEmail,
  sendNFTBookSalesEmail,
  sendNFTBookClaimedEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftClaimedEmail,
} from '../../../ses';

export async function createNewNFTBookPayment(classId, paymentId, {
  type,
  email = '',
  claimToken,
  sessionId = '',
  priceInDecimal,
  priceName,
  priceIndex,
  giftInfo,
  from = '',
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  priceInDecimal: number,
  priceName: string;
  priceIndex: number;
  from?: string;
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
    claimToken,
    sessionId,
    classId,
    priceInDecimal,
    price: priceInDecimal / 100,
    priceName,
    priceIndex,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  };
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
  priceIndex,
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
    if (execGrantTxHash) paymentPayload.execGrantTxHash = execGrantTxHash;
    t.update(bookRef.collection('transactions').doc(paymentId), paymentPayload);
    return {
      listingData: docData,
      txData: paymentData,
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

export async function handleNewStripeCheckout(classId: string, priceIndex: number, {
  gaClientId,
  from: inputFrom,
  giftInfo,
}: {
  gaClientId?: string,
  from?: string,
  giftInfo?: {
    toEmail: string,
    toName: string,
    fromName: string,
    message?: string,
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
    }) : getLikerLandNFTClaimPageURL({
      classId,
      paymentId,
      token: claimToken,
      type: 'nft_book',
      redirect: true,
    }),
    cancelUrl = getLikerLandNFTClassPageURL({ classId }),
    ownerWallet,
    connectedWallets,
    shippingRates,
    defaultPaymentCurrency = 'USD',
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
  } = bookInfo;
  if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  const {
    priceInDecimal,
    stock,
    hasShipping,
    name: priceNameObj,
    description: pricDescriptionObj,
  } = prices[priceIndex];
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
  const sessionMetadata: Stripe.MetadataParam = {
    store: 'book',
    classId,
    iscnPrefix,
    paymentId,
    priceIndex,
    ownerWallet,
  };
  if (gaClientId) sessionMetadata.gaClientId = gaClientId as string;
  if (from) sessionMetadata.from = from as string;
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    capture_method: 'manual',
    metadata: sessionMetadata,
  };

  const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
  const convertedPriceInDecimal = convertUSDToCurrency(priceInDecimal, convertedCurrency);
  if (connectedWallets && Object.keys(connectedWallets).length) {
    const isFromLikerLand = checkIsFromLikerLand(from);
    const wallet = Object.keys(connectedWallets)[0];
    const stripeConnectAccountId = await getStripeConnectAccountId(wallet);
    if (stripeConnectAccountId) {
      const stripeFeeAmount = calculateStripeFee(convertedPriceInDecimal, convertedCurrency);
      const likerLandFeeAmount = Math.ceil(
        convertedPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandCommission = isFromLikerLand
        ? Math.ceil(convertedPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
        : 0;
      const likerlandArtFee = isLikerLandArt
        ? Math.ceil(convertedPriceInDecimal * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO)
        : 0;
      // TODO: support connectedWallets +1
      paymentIntentData.application_fee_amount = (
        stripeFeeAmount + likerLandFeeAmount + likerLandCommission + likerlandArtFee
      );
      paymentIntentData.transfer_data = {
        destination: stripeConnectAccountId,
      };
      paymentIntentData.metadata = {
        ...paymentIntentData.metadata,
        stripeFeeAmount,
        likerLandFeeAmount,
        likerLandCommission,
        likerlandArtFee,
      };
    }
  }

  const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    success_url: `${successUrl}`,
    cancel_url: `${cancelUrl}`,
    line_items: [
      {
        price_data: {
          currency: convertedCurrency,
          product_data: {
            name,
            description,
            images: [encodedURL(image)],
            metadata: {
              iscnPrefix,
              classId: classId as string,
            },
          },
          unit_amount: convertedPriceInDecimal,
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
  if (hasShipping) {
    checkoutPayload.shipping_address_collection = {
      // eslint-disable-next-line max-len
      allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
    if (shippingRates) {
      checkoutPayload.shipping_options = shippingRates.map((s) => {
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
  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookPayment(classId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    priceInDecimal,
    priceName,
    priceIndex,
    giftInfo,
    from: from as string,
  });

  return {
    url,
    paymentId,
    priceName,
    priceInDecimal,
    sessionId,
  };
}

export async function sendNFTBookPurchaseEmail({
  email,
  notificationEmails,
  classId,
  className,
  paymentId,
  claimToken,
  amountTotal,
  isGift = false,
  giftInfo = null,
  mustClaimToView = false,
}) {
  if (isGift && giftInfo) {
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
      className,
      paymentId,
      claimToken,
      mustClaimToView,
    });
  } else if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      classId,
      className,
      paymentId,
      claimToken,
      mustClaimToView,
    });
  }
  if (notificationEmails && notificationEmails.length) {
    await sendNFTBookSalesEmail({
      buyerEmail: email,
      isGift,
      giftToEmail: (giftInfo as any)?.toEmail,
      giftToName: (giftInfo as any)?.toName,
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
    const {
      notificationEmails = [],
      mustClaimToView = false,
      defaultPaymentCurrency,
    } = listingData;
    const {
      claimToken, price, priceName, type, from, isGift, giftInfo,
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

    const priceInCurrency = convertUSDToCurrency(price, defaultPaymentCurrency || 'USD');
    const className = classData?.name || classId;
    await Promise.all([
      sendNFTBookPurchaseEmail({
        email,
        isGift,
        giftInfo,
        notificationEmails,
        classId,
        className,
        paymentId,
        claimToken,
        amountTotal,
        mustClaimToView,
      }),
      sendNFTBookSalesSlackNotification({
        classId,
        className,
        paymentId,
        email,
        priceName,
        priceWithCurrency: `${priceInCurrency} ${defaultPaymentCurrency || 'USD'}`,
        method: 'Fiat',
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
) {
  const bookRef = likeNFTBookCollection.doc(classId);
  const docRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);
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
      status: 'pendingNFT',
      wallet,
      message: message || '',
    });
    t.update(bookRef, {
      pendingNFTCount: FieldValue.increment(1),
    });
    return docData;
  });
  return email;
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
      className,
      paymentId,
      wallet,
      buyerEmail: email,
      message,
    });
  }
  if (isGift && giftInfo) {
    const {
      fromName,
      toName,
    } = giftInfo;
    await sendNFTBookGiftClaimedEmail({
      className,
      fromEmail: email,
      fromName,
      toName,
    });
  }
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
