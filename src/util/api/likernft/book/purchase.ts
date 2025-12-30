import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';

import { getNFTClassDataById } from '.';
import { ValidationError } from '../../../ValidationError';
import {
  PUBSUB_TOPIC_MISC,
  LIKER_LAND_WAIVED_CHANNEL,
  BOOK3_HOSTNAME,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
} from '../../../../constant';
import {
  getBookUserInfo, getBookUserInfoFromLegacyString, getBookUserInfoFromLikerId,
  getBookUserInfoFromWallet,
} from './user';
import stripe, { calculateStripeFee, getStripePromotionFromCode, normalizeLanguageForStripeLocale } from '../../../stripe';
import {
  admin, likeNFTBookCollection, FieldValue, db, likeNFTBookUserCollection,
} from '../../../firebase';
import publisher from '../../../gcloudPub';
import { sendNFTBookInvalidChannelIdSlackNotification } from '../../../slack';
import { updateIntercomUserAttributes } from '../../../intercom';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET,
} from '../../../../../config/config';
import {
  sendAutoDeliverNFTBookSalesEmail,
  sendManualNFTBookSalesEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookSalePaymentsEmail,
} from '../../../ses';
import { getUserWithCivicLikerPropertiesByWallet } from '../../users/getPublicInfo';
import type { BookGiftInfo, BookPurchaseData } from '../../../../types/book';
import { CartItemWithInfo, ItemPriceInfo, TransactionFeeInfo } from './type';
import {
  getClassCurrentTokenId, isEVMClassId, mintNFT, triggerNFTIndexerUpdate,
} from '../../../evm/nft';
import { convertUSDPriceToCurrency } from '../../../pricing';

export function checkIsFromLikerLand(from: string): boolean {
  return from === NFT_BOOK_DEFAULT_FROM_CHANNEL;
}

export async function handleStripeConnectedAccount({
  classId = '',
  priceIndex = -1,
  paymentId,
  ownerWallet,
  bookName,
  buyerEmail,
  paymentIntentId,
}: {
  classId?: string,
  priceIndex?: number,
  paymentId: string,
  ownerWallet: string,
  bookName: string,
  buyerEmail: string | null,
  paymentIntentId?: string,
}, {
  chargeId = '',
  amountTotal,
  likerLandArtFee = 0,
  channelCommission = 0,
  royaltyToSplit = 0,
}, { connectedWallets: connectedWalletsInput, from }) {
  const transfers: Stripe.Transfer[] = [];
  if (!amountTotal) return { transfers };

  let connectedWallets = connectedWalletsInput;
  if (!connectedWallets) {
    // if connectedWallets is not set before, default to ownerWallet
    connectedWallets = {
      [ownerWallet]: 1,
    };
  }

  const metadata: Record<string, string> = {
    ownerWallet,
  };
  if (classId) metadata.classId = classId;
  if (priceIndex !== undefined) metadata.priceIndex = priceIndex.toString();
  const emailMap = {};
  if (channelCommission) {
    let fromUser: any = null;
    if (from && !checkIsFromLikerLand(from)) {
      if (from.startsWith('@')) {
        fromUser = await getBookUserInfoFromLikerId(
          from.substring(1, from.length),
        );
      }
      // also check if @string is a legacy string
      if (!fromUser) {
        fromUser = await getBookUserInfoFromLegacyString(from);
      }
    }
    const isValidChannelId = fromUser && fromUser.bookUserInfo;
    let fromStripeConnectAccountId;
    let transfer: Stripe.Response<Stripe.Transfer> | null = null;
    if (isValidChannelId) {
      const { bookUserInfo, likerUserInfo, wallet } = fromUser;
      const isOwner = wallet === ownerWallet;
      const {
        stripeConnectAccountId,
        isStripeConnectReady,
      } = bookUserInfo;
      const {
        email,
        isEmailVerified,
      } = likerUserInfo || {};
      if (isStripeConnectReady) fromStripeConnectAccountId = stripeConnectAccountId;
      if (fromStripeConnectAccountId) {
        const currency = 'usd'; // stripe balance are setteled in USD in source tx
        const fromWallet = fromUser.wallet;
        transfer = await stripe.transfers.create({
          amount: channelCommission,
          currency,
          destination: fromStripeConnectAccountId,
          transfer_group: paymentId,
          source_transaction: chargeId,
          description: `Channel commission for ${bookName}`,
          metadata: {
            type: 'channelCommission',
            channel: from,
            ...metadata,
          },
        }).catch((e) => {
          // eslint-disable-next-line no-console
          console.error(`Failed to create transfer for ${fromWallet} with stripeConnectAccountId ${fromStripeConnectAccountId}`);
          // eslint-disable-next-line no-console
          console.error(e);
          return null;
        });
        if (transfer) {
          transfers.push(transfer);
          await likeNFTBookUserCollection.doc(fromWallet).collection('commissions').doc(`${paymentId}-${uuidv4()}`).create({
            type: 'channelCommission',
            ownerWallet,
            classId,
            priceIndex,
            transferId: transfer.id,
            chargeId,
            stripeConnectAccountId,
            paymentId,
            amountTotal,
            amount: channelCommission,
            currency,
            timestamp: FieldValue.serverTimestamp(),
          });
          const shouldSendNotificationEmailToChannel = !isOwner
            && email
            && isEmailVerified;
          if (shouldSendNotificationEmailToChannel) {
            emailMap[email] ??= [];
            emailMap[email].push({
              amount: channelCommission / 100,
              type: 'channelCommission',
            });
          }
        }
      }
    }
    if (from && !transfer) {
      await sendNFTBookInvalidChannelIdSlackNotification({
        classId,
        bookName,
        from,
        email: buyerEmail,
        isInvalidChannelId: !isValidChannelId,
        hasStripeAccount: !!fromStripeConnectAccountId,
        isStripeConnectReady: false,
        paymentId,
        paymentIntentId,
      });
    }
  }
  if (connectedWallets && Object.keys(connectedWallets).length) {
    const amountToSplit = royaltyToSplit;
    if (amountToSplit > 0) {
      const wallets = Object.keys(connectedWallets);
      const connectedUserInfos: any[] = await Promise.all(
        wallets.map((wallet) => getBookUserInfo(wallet)
          // eslint-disable-next-line no-console
          .catch((e) => { console.error(e); })),
      );
      const stripeConnectAccountIds = connectedUserInfos.map((userData) => {
        if (!userData) return null;
        const { stripeConnectAccountId, isStripeConnectReady } = userData;
        return isStripeConnectReady ? stripeConnectAccountId : null;
      });
      let totalSplit = 0;
      const walletToUserMap: Record<string, any> = {};
      wallets.forEach((wallet, i) => {
        const stripeConnectAccountId = stripeConnectAccountIds[i];
        const userInfo = connectedUserInfos[i];
        if (stripeConnectAccountId && userInfo) {
          walletToUserMap[wallet] = {
            ...userInfo,
            stripeConnectAccountId,
          };
          totalSplit += connectedWallets[wallet];
        }
      });
      const connectedTransfers = await Promise.all(
        Object.entries(walletToUserMap)
          .map(async ([wallet, userInfo]) => {
            const { stripeConnectAccountId } = userInfo;
            const currency = 'usd'; // stripe balance are setteled in USD in source tx
            const amountSplit = Math.floor((amountToSplit * connectedWallets[wallet]) / totalSplit);
            const transfer = await stripe.transfers.create({
              amount: amountSplit,
              currency,
              destination: userInfo.stripeConnectAccountId,
              transfer_group: paymentId,
              source_transaction: chargeId,
              description: `Connected commission for ${bookName}`,
              metadata: {
                type: 'connectedWallet',
                ...metadata,
              },
            }).catch((e) => {
              // eslint-disable-next-line no-console
              console.error(`Failed to create transfer for ${wallet} with stripeConnectAccountId ${stripeConnectAccountId}`);
              // eslint-disable-next-line no-console
              console.error(e);
            });
            if (!transfer) return null;
            await likeNFTBookUserCollection.doc(wallet).collection('commissions').doc(`${paymentId}-${uuidv4()}`).create({
              type: 'connectedWallet',
              ownerWallet,
              classId,
              priceIndex,
              transferId: transfer.id,
              chargeId,
              stripeConnectAccountId,
              paymentId,
              amountTotal,
              amount: amountSplit,
              currency,
              timestamp: FieldValue.serverTimestamp(),
            });
            const likerUserInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
            const {
              email,
              isEmailVerified,
            } = likerUserInfo || {};
            const isOwner = wallet === ownerWallet;
            const shouldSendNotificationEmailToChannel = !isOwner && email && isEmailVerified;
            if (shouldSendNotificationEmailToChannel) {
              emailMap[email] ??= [];
              const walletAmount = amountSplit / 100;
              emailMap[email].push({
                amount: walletAmount,
                type: 'connectedWallet',
              });
            }
            return transfer;
          }),
      );

      if (connectedTransfers.length) {
        // typescript doesn't regconize .filter(t => t !== null)
        connectedTransfers.forEach((t) => {
          if (t) transfers.push(t);
        });
      }
    }
  }
  if (likerLandArtFee && NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET) {
    const bookUserInfo = await getBookUserInfo(NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET);
    if (!bookUserInfo) {
      throw new Error('BOOK_USER_INFO_NOT_FOUND');
    }
    const {
      stripeConnectAccountId,
      isStripeConnectReady,
    } = bookUserInfo;
    if (stripeConnectAccountId && isStripeConnectReady) {
      const currency = 'usd'; // stripe balance are setteled in USD in source tx
      try {
        const transfer = await stripe.transfers.create({
          amount: likerLandArtFee,
          currency,
          destination: stripeConnectAccountId,
          transfer_group: paymentId,
          source_transaction: chargeId,
          description: `Art Fee for ${bookName}`,
          metadata: {
            type: 'artFee',
            ...metadata,
          },
        });
        transfers.push(transfer);
        await likeNFTBookUserCollection.doc(NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET).collection('commissions').doc(`${paymentId}-${uuidv4()}`).create({
          type: 'artFee',
          ownerWallet,
          classId,
          priceIndex,
          transferId: transfer.id,
          chargeId,
          stripeConnectAccountId,
          paymentId,
          amountTotal,
          amount: likerLandArtFee,
          currency,
          timestamp: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`Failed to create transfer for ${NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET} with stripeConnectAccountId ${stripeConnectAccountId}`);
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
  }
  await Promise.all(Object.entries(emailMap)
    .map(([email, payments]) => sendNFTBookSalePaymentsEmail({
      email,
      classId,
      paymentId,
      bookName,
      payments,
    // eslint-disable-next-line no-console
    }).catch(console.error)));
  return { transfers };
}

export async function createNewNFTBookPayment(classId, paymentId, {
  type,
  email = '',
  cartId,
  claimToken,
  sessionId = '',
  priceInDecimal,
  originalPriceInDecimal,
  coupon,
  quantity = 1,
  priceName,
  priceIndex,
  giftInfo,
  from = '',
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
  priceName: string;
  priceIndex: number;
  from?: string;
  giftInfo?: {
    toName: string,
    toEmail: string,
    fromName: string,
    message?: string,
  };
  itemPrices?: any[],
  feeInfo?: TransactionFeeInfo,
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
    originalPriceInDecimal,
    price: priceInDecimal / 100,
    originalPrice: originalPriceInDecimal / 100,
    priceName,
    priceIndex,
    quantity,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  };
  if (cartId) payload.cartId = cartId;
  if (coupon) payload.coupon = coupon;
  if (itemPrices) payload.itemPrices = itemPrices;
  if (feeInfo) payload.feeInfo = feeInfo;

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

export async function processNFTBookPurchaseTxGet(t, classId, paymentId, {
  email,
}) {
  const bookRef = likeNFTBookCollection.doc(classId);
  const doc = await t.get(bookRef);
  const docData = doc.data();
  if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
  const paymentDoc = await t.get(bookRef.collection('transactions').doc(paymentId));
  const paymentData = paymentDoc.data();
  if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
  const { quantity, status, priceIndex } = paymentData;
  if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_PROCESSED');
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
  const paymentPayload: any = {
    isPaid: true,
    isPendingClaim: true,
    status: 'paid',
    email,
  };
  if (isAutoDeliver) {
    // EVM NFT are mint on demand, we don't need to specify nftId
    const nftIds = Array(quantity).fill(0);
    [paymentPayload.nftId] = nftIds;
    paymentPayload.nftIds = nftIds;
    paymentPayload.isAutoDeliver = true;
    paymentPayload.autoMemo = autoMemo;
  } else {
    if (stock - quantity < 0) throw new ValidationError('OUT_OF_STOCK');
    priceInfo.stock -= quantity;
  }

  priceInfo.sold += quantity;
  priceInfo.lastSaleTimestamp = firestore.Timestamp.now();

  return {
    listingData: docData,
    txData: { ...paymentData, ...paymentPayload },
  };
}

export async function processNFTBookPurchaseTxUpdate(t, classId, paymentId, {
  listingData,
  txData,
}) {
  const bookRef = likeNFTBookCollection.doc(classId);
  const {
    prices,
  } = listingData;
  if (txData.nftIds) {
    txData.nftIds.forEach((nftId) => {
      // placeholder nftId is 0
      if (nftId) t.update(bookRef.collection('nft').doc(nftId), { isProcessing: true });
    });
  }
  t.update(bookRef.collection('transactions').doc(paymentId), txData);
  t.update(bookRef, {
    prices,
    lastSaleTimestamp: FieldValue.serverTimestamp(),
  });
  return {
    listingData,
    txData,
  };
}

export function calculateItemPrices(items: CartItemWithInfo[], from) {
  const itemPrices: ItemPriceInfo[] = items.map(
    (item) => {
      const isFromLikerLand = checkIsFromLikerLand(item.from || from);
      const isFree = !item.priceInDecimal && !item.customPriceDiffInDecimal;
      const isCommissionWaived = from === LIKER_LAND_WAIVED_CHANNEL;
      const customPriceDiffInDecimal = item.customPriceDiffInDecimal || 0;
      const { priceInDecimal, originalPriceInDecimal } = item;
      const priceInDecimalWithoutTip = priceInDecimal - customPriceDiffInDecimal;
      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );
      const likerLandFeeAmount = isFree ? 0 : Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      const channelCommission = (from && !isCommissionWaived && !isFromLikerLand && !isFree)
        ? Math.max(Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ), 0)
        : 0;
      const likerLandCommission = (isFromLikerLand && !isFree)
        ? Math.max(Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ), 0)
        : 0;
      const likerLandArtFee = (item.isLikerLandArt && !isFree)
        ? Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO)
        : 0;

      const payload: ItemPriceInfo = {
        quantity: item.quantity,
        currency: 'usd',
        priceInDecimal,
        customPriceDiffInDecimal,
        originalPriceInDecimal,
        likerLandTipFeeAmount,
        likerLandFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      };
      if (item.classId) payload.classId = item.classId;
      if (item.priceIndex !== undefined) payload.priceIndex = item.priceIndex;
      if (item.stripePriceId) payload.stripePriceId = item.stripePriceId;
      return payload;
    },
  );
  return itemPrices;
}

export async function formatStripeCheckoutSession({
  classId,
  iscnPrefix,
  cartId,
  paymentId,
  priceIndex,
  email,
  likeWallet,
  evmWallet,
  customerId,
  from,
  coupon,
  couponId,
  currency,
  claimToken,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
  fbClickId,
  giftInfo,
  referrer,
  utm,
  httpMethod,
  userAgent,
  clientIp,
  language,
}: {
  classId?: string,
  iscnPrefix?: string,
  cartId?: string,
  priceIndex?: number,
  paymentId: string,
  email?: string,
  likeWallet?: string,
  evmWallet?: string,
  customerId?: string,
  from?: string,
  coupon?: string,
  couponId?: string,
  currency?: string,
  claimToken: string,
  gaClientId?: string,
  gaSessionId?: string,
  gadClickId?: string,
  gadSource?: string,
  fbClickId?: string,
  giftInfo?: {
    fromName: string,
    toName: string,
    toEmail: string,
    message?: string,
  },
  referrer?: string,
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
    content?: string,
    term?: string,
  },
  httpMethod?: 'GET' | 'POST',
  userAgent?: string,
  clientIp?: string,
  language?: string,
}, items: CartItemWithInfo[], {
  successUrl,
  cancelUrl,
  paymentMethods,
}: {
  successUrl: string,
  cancelUrl: string,
  paymentMethods?: string[],
}) {
  const sessionMetadata: Stripe.MetadataParam = {
    store: 'book',
    paymentId,
  };
  if (cartId) sessionMetadata.cartId = cartId;
  if (classId) sessionMetadata.classId = classId;
  if (iscnPrefix) sessionMetadata.iscnPrefix = iscnPrefix;
  if (priceIndex !== undefined) sessionMetadata.priceIndex = priceIndex.toString();
  if (claimToken) sessionMetadata.claimToken = claimToken;
  if (gaClientId) sessionMetadata.gaClientId = gaClientId;
  if (gaSessionId) sessionMetadata.gaSessionId = gaSessionId;
  if (gadClickId) sessionMetadata.gadClickId = gadClickId;
  if (gadSource) sessionMetadata.gadSource = gadSource;
  if (from) sessionMetadata.from = from;
  if (giftInfo) {
    sessionMetadata.giftInfo = giftInfo.toEmail;
    sessionMetadata.giftToEmail = giftInfo.toEmail;
    sessionMetadata.giftFromName = giftInfo.fromName;
    sessionMetadata.giftToName = giftInfo.toName;
    if (giftInfo.message) sessionMetadata.giftMessage = giftInfo.message;
  }
  if (utm?.campaign) sessionMetadata.utmCampaign = utm.campaign;
  if (utm?.source) sessionMetadata.utmSource = utm.source;
  if (utm?.medium) sessionMetadata.utmMedium = utm.medium;
  if (utm?.content) sessionMetadata.utmContent = utm.content;
  if (utm?.term) sessionMetadata.utmTerm = utm.term;
  if (httpMethod) sessionMetadata.httpMethod = httpMethod;
  if (referrer) sessionMetadata.referrer = referrer.substring(0, 500);
  if (userAgent) sessionMetadata.userAgent = userAgent;
  if (clientIp) sessionMetadata.clientIp = clientIp;
  if (fbClickId) sessionMetadata.fbClickId = fbClickId;
  if (likeWallet) sessionMetadata.likeWallet = likeWallet;
  if (evmWallet) sessionMetadata.evmWallet = evmWallet;
  if (items.length) {
    sessionMetadata.fromList = items.map((item) => item.from).join(',');
  }
  const currencyWithDefault: 'hkd' | 'twd' | 'usd' = currency as 'hkd' | 'twd' | 'usd' || 'usd';

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    capture_method: 'automatic',
    metadata: sessionMetadata,
  };
  const itemPrices = calculateItemPrices(items, from);
  const itemWithPrices = items.map(
    (item, index) => ({
      ...itemPrices[index],
      ...item,
    }),
  );
  const totalPriceInDecimal = items.reduce(
    (acc, item) => acc + item.priceInDecimal * item.quantity,
    0,
  );
  const stripeFeeAmount = calculateStripeFee(totalPriceInDecimal, currencyWithDefault);
  const likerLandTipFeeAmount = itemPrices.reduce(
    (acc, item) => acc + item.likerLandTipFeeAmount * item.quantity,
    0,
  );
  const likerLandFeeAmount = itemPrices.reduce(
    (acc, item) => acc + item.likerLandFeeAmount * item.quantity,
    0,
  );
  const likerLandCommission = itemPrices.reduce(
    (acc, item) => acc + item.likerLandCommission * item.quantity,
    0,
  );
  const channelCommission = itemPrices.reduce(
    (acc, item) => acc + item.channelCommission * item.quantity,
    0,
  );
  const likerLandArtFee = itemPrices.reduce(
    (acc, item) => acc + item.likerLandArtFee * item.quantity,
    0,
  );
  const totalOriginalPriceInDecimal = itemPrices.reduce(
    (acc, item) => acc + item.originalPriceInDecimal * item.quantity,
    0,
  );
  const totalCustomPriceDiffInDecimal = itemPrices.reduce(
    (acc, item) => acc + item.customPriceDiffInDecimal * item.quantity,
    0,
  );
  paymentIntentData.transfer_group = paymentId;
  paymentIntentData.metadata = sessionMetadata;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  itemWithPrices.forEach((item) => {
    const productMetadata: Stripe.MetadataParam = {};
    if (item.classId) productMetadata.classId = item.classId;
    if (item.iscnPrefix) productMetadata.iscnPrefix = item.iscnPrefix;

    if (item.stripePriceId) {
      lineItems.push({
        price: item.stripePriceId,
        adjustable_quantity: {
          enabled: false,
        },
        quantity: item.quantity,
      });
    } else {
      lineItems.push({
        price_data: {
          currency: currencyWithDefault,
          product_data: {
            name: item.name,
            description: item.description,
            images: item.images,
            metadata: productMetadata,
          },
          unit_amount: convertUSDPriceToCurrency(
            item.originalPriceInDecimal / 100,
            currencyWithDefault,
          ) * 100,
        },
        adjustable_quantity: {
          enabled: false,
        },
        quantity: item.quantity,
      });
    }
    if (item.customPriceDiffInDecimal) {
      const convertedPriceDiffInDecimal = convertUSDPriceToCurrency(
        item.customPriceDiffInDecimal / 100,
        currencyWithDefault,
      ) * 100;
      lineItems.push({
        price_data: {
          currency: currencyWithDefault,
          product_data: {
            name: 'Extra Tip',
            description: 'Fund will be distributed to stakeholders and creators',
            metadata: {
              tippingFor: item.classId || 'unknown',
              ...productMetadata,
            },
          },
          unit_amount: convertedPriceDiffInDecimal,
        },
        quantity: item.quantity,
      });
    }
  });

  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
  if (coupon) {
    try {
      const promotion = await getStripePromotionFromCode(coupon);
      if (promotion) {
        discounts.push({ promotion_code: promotion.id });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }
  if (!discounts.length && couponId) {
    discounts.push({ coupon: couponId });
  }

  const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    success_url: `${successUrl}`,
    cancel_url: `${cancelUrl}`,
    line_items: lineItems,
    payment_intent_data: paymentIntentData,
    metadata: sessionMetadata,
    consent_collection: {
      promotions: 'auto',
    },
    locale: normalizeLanguageForStripeLocale(language),
  };
  if (currency) {
    checkoutPayload.currency = currency;
  } else {
    checkoutPayload.adaptive_pricing = { enabled: true };
  }
  if (paymentMethods) {
    checkoutPayload.payment_method_types = paymentMethods as
      Stripe.Checkout.SessionCreateParams.PaymentMethodType[];
  }
  if (discounts.length) {
    checkoutPayload.discounts = discounts;
  } else {
    checkoutPayload.allow_promotion_codes = true;
  }
  if (likeWallet || evmWallet) {
    if (customerId) {
      checkoutPayload.customer = customerId;
    } else {
      checkoutPayload.customer_creation = 'always';
    }
    checkoutPayload.saved_payment_method_options = {
      payment_method_save: 'enabled',
    };
  }
  if (email && !customerId) checkoutPayload.customer_email = email;
  let session;
  try {
    session = await stripe.checkout.sessions.create(checkoutPayload);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      throw new ValidationError(error.message, 400);
    }
    throw error;
  }
  return {
    session,
    itemPrices,
    feeInfo: {
      priceInDecimal: totalPriceInDecimal,
      originalPriceInDecimal: totalOriginalPriceInDecimal,
      stripeFeeAmount,
      likerLandTipFeeAmount,
      likerLandFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
      customPriceDiffInDecimal: totalCustomPriceDiffInDecimal,
    },
  };
}

export async function sendNFTBookClaimedEmailNotification(
  classId: string,
  paymentId: string,
  isAutoDeliver: boolean,
  feeInfo: TransactionFeeInfo,
  {
    wallet, email, isGift, giftInfo, from, coupon,
  } : {
      wallet: string,
      email: string,
      isGift?: boolean,
      from?: string,
      coupon?: string,
      giftInfo?: {
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
  const { ownerWallet } = docData;
  const ownerInfo = await getBookUserInfoFromWallet(ownerWallet);
  const ownerEmail = ownerInfo?.likerUserInfo?.isEmailVerified
    ? ownerInfo?.likerUserInfo?.email
    : undefined;
  const classData = await getNFTClassDataById(classId).catch(() => null);
  const className = classData?.name || classId;
  if (ownerEmail) {
    if (isAutoDeliver) {
      await sendAutoDeliverNFTBookSalesEmail({
        email: ownerEmail,
        classId,
        bookName: className,
        paymentId,
        wallet,
        buyerEmail: email,
        claimerEmail: giftInfo?.toEmail || email,
        feeInfo,
        coupon,
        from,
      });
    } else {
      await sendManualNFTBookSalesEmail({
        email: ownerEmail,
        classId,
        bookName: className,
        paymentId,
        wallet,
        buyerEmail: email,
        claimerEmail: giftInfo?.toEmail || email,
        feeInfo,
        coupon,
        from,
      });
    }
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

export async function claimNFTBook(
  classId: string,
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
  const bookRef = likeNFTBookCollection.doc(classId);
  const docRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);
  const {
    email,
    coupon,
    isAutoDeliver,
    nftId,
    nftIds,
    autoMemo = '',
    quantity,
    feeInfo,
    from,
  } = await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) {
      throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
    }
    const {
      claimToken,
      status,
      wallet: claimedWallet,
    } = docData;
    if (token !== claimToken) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }
    if (claimedWallet && claimedWallet !== wallet) {
      throw new ValidationError('PAYMENT_ALREADY_CLAIMED_BY_OTHER', 403);
    }

    if (status !== 'paid') {
      if (claimedWallet) {
        throw new ValidationError('PAYMENT_ALREADY_CLAIMED_BY_WALLET', 409);
      }
      throw new ValidationError('PAYMENT_ALREADY_CLAIMED', 403);
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
        pendingNFTCount: FieldValue.increment(1),
      });
    }
    return docData;
  });

  let txHash = '';
  if (isAutoDeliver) {
    const msgSendNftIds = nftIds || [nftId];
    try {
      const [metadata, fromTokenId] = await Promise.all([
        getNFTClassDataById(classId),
        getClassCurrentTokenId(classId),
      ]);
      txHash = await mintNFT(
        classId,
        wallet,
        {
          image: metadata?.image as string | undefined,
          external_url: `https://${BOOK3_HOSTNAME}/store/${classId}`,
          description: metadata?.description as string | undefined,
          name: metadata?.name as string | undefined,
          attributes: metadata?.attributes,
        },
        { count: msgSendNftIds.length, memo: autoMemo, fromTokenId },
      );
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

    const { isGift, giftInfo } = await db.runTransaction(async (t: admin.firestore.Transaction) => {
      // eslint-disable-next-line no-use-before-define
      const paymentDocData = await updateNFTBookPostDeliveryData({
        classId,
        paymentId,
        txHash,
        quantity,
        isAutoDeliver,
      }, t);
      // only update nft status if nftId is not placeholder (0)
      msgSendNftIds.filter((id) => !!id).forEach((id) => {
        t.update(bookRef.collection('nft').doc(id), {
          ownerWallet: wallet,
          isProcessing: false,
          isSold: true,
        });
      });
      return paymentDocData;
    });

    if (isGift && giftInfo && email) {
      const giftInfoTyped = giftInfo as BookGiftInfo;
      const {
        fromName,
        toName,
      } = giftInfoTyped;
      const classData = await getNFTClassDataById(classId).catch(() => null);
      const className = classData?.name || classId;
      if (email) {
        await sendNFTBookGiftSentEmail({
          fromEmail: email,
          fromName,
          toName,
          bookName: className,
          txHash,
        });
      }
    }

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTSentUpdate',
      isAutoDeliver,
      paymentId,
      classId,
      email,
      fromWallet: req?.user?.wallet,
      toWallet: wallet,
      nftId,
      txHash,
      isGift,
    });

    if (isEVMClassId(classId)) {
      try {
        await triggerNFTIndexerUpdate({ classId });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Failed to trigger NFT indexer update for class ${classId}:`, err);
      }
    }
  }
  try {
    await sendNFTBookClaimedEmailNotification(
      classId,
      paymentId,
      isAutoDeliver,
      feeInfo,
      {
        wallet,
        email,
        coupon,
        from: checkIsFromLikerLand(from) ? undefined : from,
      },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to send email notification', e);
  }

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'BookNFTClaimed',
    paymentId,
    classId,
    wallet,
    email,
    buyerMessage: message,
    loginMethod,
  });

  const { priceInDecimal } = feeInfo as TransactionFeeInfo;
  let likerId: string | undefined;
  try {
    const user = await getUserWithCivicLikerPropertiesByWallet(wallet);
    likerId = user?.user;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch likerId for wallet', wallet, e);
  }
  if (likerId) {
    if (priceInDecimal === 0) {
      await updateIntercomUserAttributes(likerId, {
        has_claimed_free_book: true,
      });
    } else if (priceInDecimal > 0) {
      await updateIntercomUserAttributes(likerId, {
        has_purchased_paid_book: true,
      });
    }
  }

  return {
    email, nftIds, nftId: nftIds?.[0], txHash,
  };
}

export async function setNFTBookBuyerMessage(
  classId: string,
  paymentId: string,
  message: string,
  wallet: string,
  token: string,
  req,
) {
  const bookRef = likeNFTBookCollection.doc(classId);
  const docRef = bookRef.collection('transactions').doc(paymentId);
  await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
    const {
      claimToken,
      wallet: claimedWallet,
      message: existingMessage = '',
    } = docData;
    if (token !== claimToken) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }
    if (existingMessage && existingMessage !== message) {
      throw new ValidationError('PAYMENT_MESSAGE_ALREADY_SET', 409);
    }
    if (claimedWallet && claimedWallet !== wallet) {
      throw new ValidationError('PAYMENT_ALREADY_CLAIMED_BY_OTHER', 409);
    }
    t.update(docRef, { message });
  });

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'BookNFTBuyerMessageUpdated',
    paymentId,
    classId,
    wallet,
    buyerMessage: message,
  });
}

export async function updateNFTBookPostDeliveryData({
  classId,
  paymentId,
  txHash,
  quantity = 1,
  isAutoDeliver = false,
}: {
  classId: string,
  paymentId: string,
  txHash: string,
  quantity?: number,
  isAutoDeliver?: boolean,
}, t: any) {
  // TODO: check tx content contains valid nft info and address
  const bookDocRef = likeNFTBookCollection.doc(classId);
  const paymentDocRef = bookDocRef.collection('transactions').doc(paymentId);
  const paymentDoc = await t.get(paymentDocRef);
  const paymentDocData = paymentDoc.data();
  if (!paymentDocData) {
    throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
  }
  const { status, quantity: docQuantity = 1 } = paymentDocData as BookPurchaseData;
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
    t.update(bookDocRef, {
      pendingNFTCount: FieldValue.increment(-1),
    });
  }
  return paymentDocData as BookPurchaseData;
}
