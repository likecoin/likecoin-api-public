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
  LIST_OF_BOOK_SHIPPING_COUNTRY,
  PUBSUB_TOPIC_MISC,
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  LIKER_LAND_WAIVED_CHANNEL,
} from '../../../../constant';
import { parseImageURLFromMetadata } from '../metadata';
import { calculateStripeFee, checkIsFromLikerLand, handleNFTPurchaseTransaction } from '../purchase';
import {
  getBookUserInfo, getBookUserInfoFromLegacyString, getBookUserInfoFromLikerId,
} from './user';
import stripe, { getStripePromotionFromCode } from '../../../stripe';
import {
  likeNFTBookCollection, FieldValue, db, likeNFTBookUserCollection,
} from '../../../firebase';
import publisher from '../../../gcloudPub';
import { calculateTxGasFee } from '../../../cosmos/tx';
import { sendNFTBookSalesSlackNotification, sendNFTBookInvalidChannelIdSlackNotification } from '../../../slack';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_TARGET_ADDRESS,
  LIKER_NFT_FEE_ADDRESS,
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET,
} from '../../../../../config/config';
import {
  sendNFTBookPendingClaimEmail,
  sendNFTBookSalesEmail,
  sendNFTBookClaimedEmail,
  sendNFTBookPhysicalOnlyEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookSalePaymentsEmail,
} from '../../../ses';
import { createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../airtable';
import { getUserWithCivicLikerPropertiesByWallet } from '../../users/getPublicInfo';
import { getReaderSegmentNameFromAuthorWallet, upsertCrispProfile } from '../../../crisp';
import logPixelEvents from '../../../fbq';

export type ItemPriceInfo = {
  quantity: number;
  currency: string;
  priceInDecimal: number;
  customPriceDiffInDecimal: number;
  originalPriceInDecimal: number;
  likerLandTipFeeAmount: number;
  likerLandFeeAmount: number;
  likerLandCommission: number;
  channelCommission: number;
  likerLandArtFee: number;
  classId?: string;
  priceIndex?: number;
  iscnPrefix?: string;
  collectionId?: string;
}

export type TransactionFeeInfo = {
  priceInDecimal: number
  originalPriceInDecimal: number
  stripeFeeAmount: number
  likerLandTipFeeAmount: number
  likerLandFeeAmount: number
  likerLandCommission: number
  channelCommission: number
  likerLandArtFee: number
  customPriceDiff: number
}

export async function handleStripeConnectedAccount({
  classId = '',
  collectionId = '',
  priceIndex = -1,
  paymentId,
  ownerWallet,
  bookName,
  buyerEmail,
  paymentIntentId,
  shippingCost,
}: {
  classId?: string,
  collectionId?: string,
  priceIndex?: number,
  paymentId: string,
  ownerWallet: string,
  bookName: string,
  buyerEmail: string | null,
  paymentIntentId: string,
  shippingCost?: number,
}, {
  chargeId,
  amountTotal,
  stripeFeeAmount = 0,
  likerLandFeeAmount = 0,
  likerLandTipFeeAmount = 0,
  likerLandCommission = 0,
  likerLandArtFee = 0,
  channelCommission = 0,
}, { connectedWallets, from }) {
  const transfers: Stripe.Transfer[] = [];
  const metadata: Record<string, string> = {
    ownerWallet,
  };
  if (classId) metadata.classId = classId;
  if (collectionId) metadata.collectionId = collectionId;
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
      const { bookUserInfo, likerUserInfo } = fromUser;
      const {
        stripeConnectAccountId,
        isStripeConnectReady,
        isEnableNotificationEmails = true,
      } = bookUserInfo;
      const {
        email,
        isEmailVerified,
      } = likerUserInfo || {};
      if (isStripeConnectReady) fromStripeConnectAccountId = stripeConnectAccountId;
      if (fromStripeConnectAccountId) {
        const currency = 'usd'; // stripe balance are setteled in USD in source tx
        const fromLikeWallet = fromUser.likeWallet;
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
          console.error(`Failed to create transfer for ${fromLikeWallet} with stripeConnectAccountId ${fromStripeConnectAccountId}`);
          // eslint-disable-next-line no-console
          console.error(e);
          return null;
        });
        if (transfer) {
          transfers.push(transfer);
          await likeNFTBookUserCollection.doc(fromLikeWallet).collection('commissions').doc(`${paymentId}-${uuidv4()}`).create({
            type: 'channelCommission',
            ownerWallet,
            classId,
            priceIndex,
            collectionId,
            transferId: transfer.id,
            chargeId,
            stripeConnectAccountId,
            paymentId,
            amountTotal,
            amount: channelCommission,
            currency,
            timestamp: FieldValue.serverTimestamp(),
          });
          const shouldSendNotificationEmail = isEnableNotificationEmails
            && email
            && isEmailVerified;
          if (shouldSendNotificationEmail) {
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
    const amountToSplit = amountTotal
      - channelCommission
      - (stripeFeeAmount
        + likerLandFeeAmount
        + likerLandCommission
        + likerLandArtFee
        + likerLandTipFeeAmount);
    if (amountToSplit > 0) {
      const wallets = Object.keys(connectedWallets);
      const connectedUserInfos: any[] = await Promise.all(
        wallets.map((wallet) => getBookUserInfo(wallet)
          // eslint-disable-next-line no-console
          .catch((e) => { console.error(e); })),
      );
      const stripeConnectAccountIds = connectedUserInfos.map((userData) => {
        const { stripeConnectAccountId, isStripeConnectReady } = userData;
        return isStripeConnectReady ? stripeConnectAccountId : null;
      });
      let totalSplit = 0;
      const walletToUserMap: Record<string, any> = {};
      wallets.forEach((wallet, i) => {
        const stripeConnectAccountId = stripeConnectAccountIds[i];
        const userInfo = connectedUserInfos[i];
        if (stripeConnectAccountId) {
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
            const {
              stripeConnectAccountId,
              isEnableNotificationEmails = true,
            } = userInfo;
            const currency = 'usd'; // stripe balance are setteled in USD in source tx
            const amountSplit = Math.floor((amountToSplit * connectedWallets[wallet]) / totalSplit);
            const shippingCostSplit = Math.floor(
              ((shippingCost || 0) * connectedWallets[wallet]) / totalSplit,
            );
            const transfer = await stripe.transfers.create({
              amount: amountSplit,
              currency,
              destination: userInfo.stripeConnectAccountId,
              transfer_group: paymentId,
              source_transaction: chargeId,
              description: `Connected commission${shippingCostSplit ? ' and shipping' : ''} for ${bookName}`,
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
              collectionId,
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
            const shouldSendNotificationEmail = isEnableNotificationEmails
              && email && isEmailVerified;
            if (shouldSendNotificationEmail) {
              emailMap[email] ??= [];
              const walletAmount = amountSplit / 100 - shippingCostSplit;
              emailMap[email].push({
                amount: walletAmount,
                type: 'connectedWallet',
              });
              if (shippingCostSplit) {
                emailMap[email].push({
                  amount: shippingCostSplit,
                  type: 'shipping',
                });
              }
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
          collectionId,
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
      collectionId,
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
  isPhysicalOnly = false,
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
  quantity?: number,
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
  itemPrices?: any[],
  feeInfo?: TransactionFeeInfo,
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
    quantity,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  };
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
  hasShipping,
  email,
  phone,
  shippingDetails,
  shippingCost,
  execGrantTxHash,
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
  if (stock - quantity < 0) throw new ValidationError('OUT_OF_STOCK');
  priceInfo.stock -= quantity;
  priceInfo.sold += quantity;
  priceInfo.lastSaleTimestamp = firestore.Timestamp.now();
  const paymentPayload: any = {
    isPaid: true,
    isPendingClaim: true,
    hasShipping,
    status: 'paid',
    email,
  };
  if (phone) paymentPayload.phone = phone;
  if (isAutoDeliver) {
    const nftRes = await t.get(bookRef
      .collection('nft')
      .where('isSold', '==', false)
      .where('isProcessing', '==', false)
      .limit(quantity));
    if (nftRes.size !== quantity) throw new ValidationError('UNSOLD_NFT_BOOK_NOT_FOUND');
    const nftIds = nftRes.docs.map((d) => d.id);
    paymentPayload.isAutoDeliver = true;
    paymentPayload.autoMemo = autoMemo;
    [paymentPayload.nftId] = nftIds;
    paymentPayload.nftIds = nftIds;
  }
  if (hasShipping) paymentPayload.shippingStatus = 'pending';
  if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
  if (shippingCost) paymentPayload.shippingCost = shippingCost.amount_total / 100;
  if (execGrantTxHash) paymentPayload.execGrantTxHash = execGrantTxHash;

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
      t.update(bookRef.collection('nft').doc(nftId), { isProcessing: true });
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

export async function processNFTBookPurchase({
  classId,
  email,
  phone,
  paymentId,
  shippingDetails,
  shippingCost,
  execGrantTxHash = '',
}) {
  const hasShipping = !!shippingDetails;
  const data = await db.runTransaction(async (t) => {
    const {
      txData,
      listingData,
    } = await processNFTBookPurchaseTxGet(t, classId, paymentId, {
      email,
      phone,
      shippingDetails,
      shippingCost,
      execGrantTxHash,
      hasShipping,
    });
    await processNFTBookPurchaseTxUpdate(t, classId, paymentId, {
      listingData,
      txData,
    });
    return {
      listingData,
      txData,
    };
  });
  return data;
}

export async function formatStripeCheckoutSession({
  classId,
  iscnPrefix,
  cartId,
  collectionId,
  paymentId,
  priceIndex,
  email,
  from,
  coupon,
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
}: {
  classId?: string,
  iscnPrefix?: string,
  cartId?: string,
  collectionId?: string,
  priceIndex?: number,
  paymentId: string,
  email?: string,
  from?: string,
  coupon?: string,
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
  },
  httpMethod?: 'GET' | 'POST',
  userAgent?: string,
  clientIp?: string,
}, items: {
  name: string,
  description: string,
  images: string[],
  priceInDecimal: number,
  customPriceDiffInDecimal?: number,
  isLikerLandArt: boolean,
  quantity: number,
  ownerWallet: string,
  classId?: string,
  priceIndex?: number,
  collectionId?: string,
  iscnPrefix?: string,
  from?: string,
}[], {
  hasShipping,
  shippingRates,
  successUrl,
  cancelUrl,
}: {
  hasShipping: boolean,
  shippingRates: any[],
  successUrl: string,
  cancelUrl: string,
}) {
  let sessionMetadata: Stripe.MetadataParam = {
    store: 'book',
    paymentId,
  };
  if (cartId) sessionMetadata.cartId = cartId;
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
  if (referrer) sessionMetadata.referrer = referrer;
  if (userAgent) sessionMetadata.userAgent = userAgent;
  if (clientIp) sessionMetadata.clientIp = clientIp;
  if (fbClickId) sessionMetadata.fbClickId = fbClickId;

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    capture_method: 'manual',
    metadata: sessionMetadata,
  };

  const itemPrices = items.map(
    (item) => {
      const isFromLikerLand = checkIsFromLikerLand(item.from || from);
      const isCommissionWaived = from === LIKER_LAND_WAIVED_CHANNEL;
      const customPriceDiffInDecimal = item.customPriceDiffInDecimal || 0;
      const { priceInDecimal } = item;
      const originalPriceInDecimal = priceInDecimal - customPriceDiffInDecimal;
      const likerLandFeeAmount = Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      const channelCommission = (from && !isCommissionWaived && !isFromLikerLand)
        ? Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
        : 0;
      const likerLandCommission = isFromLikerLand
        ? Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
        : 0;
      const likerLandArtFee = item.isLikerLandArt
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
      if (item.iscnPrefix) payload.iscnPrefix = item.iscnPrefix;
      if (item.collectionId) payload.collectionId = item.collectionId;
      return payload;
    },
  );
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
  const stripeFeeAmount = calculateStripeFee(totalPriceInDecimal);
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
  sessionMetadata = {
    ...sessionMetadata,
    stripeFeeAmount,
    likerLandTipFeeAmount,
    likerLandFeeAmount,
    likerLandCommission,
    channelCommission,
    likerLandArtFee,
  };

  if (totalCustomPriceDiffInDecimal) {
    sessionMetadata.customPriceDiff = totalCustomPriceDiffInDecimal;
  }

  paymentIntentData.metadata = sessionMetadata;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  itemWithPrices.forEach((item) => {
    const productMetadata: Stripe.MetadataParam = {};
    if (item.classId) productMetadata.classId = item.classId;
    if (item.iscnPrefix) productMetadata.iscnPrefix = item.iscnPrefix;
    if (item.collectionId) productMetadata.collectionId = item.collectionId;

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: item.description,
          images: item.images,
          metadata: productMetadata,
        },
        unit_amount: item.originalPriceInDecimal,
      },
      adjustable_quantity: {
        enabled: false,
      },
      quantity: item.quantity,
    });
    if (item.customPriceDiffInDecimal) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Extra Tip',
            description: 'Fund will be distributed to stakeholders and creators',
            metadata: {
              tippingFor: item.collectionId || item.classId || 'unknown',
              ...productMetadata,
            },
          },
          unit_amount: item.customPriceDiffInDecimal,
        },
        quantity: item.quantity,
      });
    }
  });

  let promotion: Stripe.PromotionCode | null = null;
  if (coupon) {
    try {
      promotion = await getStripePromotionFromCode(coupon);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
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
  };
  if (promotion) {
    checkoutPayload.discounts = [{ promotion_code: promotion.id }];
  } else {
    checkoutPayload.allow_promotion_codes = true;
  }
  if (email) checkoutPayload.customer_email = email;
  if (hasShipping) {
    checkoutPayload.shipping_address_collection = {
      // eslint-disable-next-line max-len
      allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
    checkoutPayload.phone_number_collection = { enabled: true };
    if (shippingRates) {
      checkoutPayload.shipping_options = shippingRates
        .filter((s) => s?.name && s?.priceInDecimal >= 0)
        .map((s) => {
          const { name: shippingName, priceInDecimal: shippingPriceInDecimal } = s;
          return {
            shipping_rate_data: {
              display_name: shippingName[NFT_BOOK_TEXT_DEFAULT_LOCALE],
              type: 'fixed_amount',
              fixed_amount: {
                amount: shippingPriceInDecimal,
                currency: 'usd',
              },
            },
          };
        });
    }
  }
  const session = await stripe.checkout.sessions.create(checkoutPayload);
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
      customPriceDiff: totalCustomPriceDiffInDecimal,
    },
  };
}

export async function handleNewStripeCheckout(classId: string, priceIndex: number, {
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
  fbClickId,
  from: inputFrom,
  coupon,
  customPriceInDecimal,
  quantity = 1,
  email,
  giftInfo,
  referrer,
  utm,
  httpMethod,
  userAgent,
  clientIp,
}: {
  httpMethod?: 'GET' | 'POST',
  gaClientId?: string,
  gaSessionId?: string,
  gadClickId?: string,
  gadSource?: string,
  fbClickId?: string,
  email?: string,
  from?: string,
  coupon?: string,
  customPriceInDecimal?: number,
  quantity?: number,
  giftInfo?: {
    toEmail: string,
    toName: string,
    fromName: string,
    message?: string,
  },
  referrer?: string,
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
  },
  userAgent?: string,
  clientIp?: string,
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
      gadClickId,
      gadSource,
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
      gadClickId,
      gadSource,
    }),
    cancelUrl = getLikerLandNFTClassPageURL({
      classId,
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
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
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
      gadClickId,
      gadSource,
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

  const {
    session,
    itemPrices,
    feeInfo,
  } = await formatStripeCheckoutSession({
    classId,
    iscnPrefix,
    paymentId,
    priceIndex,
    from,
    coupon,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    email,
    giftInfo,
    utm,
    referrer,
    httpMethod,
    userAgent,
    clientIp,
  }, [{
    name,
    description,
    images: image ? [image] : [],
    priceInDecimal,
    customPriceDiffInDecimal,
    quantity,
    isLikerLandArt,
    ownerWallet,
    classId,
    iscnPrefix,
  }], {
    hasShipping,
    shippingRates,
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
    quantity,
    priceName,
    priceIndex,
    giftInfo,
    isPhysicalOnly,
    from: from as string,
    itemPrices,
    feeInfo,
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
  shippingDetails,
  phone = '',
  shippingCost = 0,
  originalPrice = amountTotal,
  from,
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
      from,
    });
  }
  await sendNFTBookSalesEmail({
    buyerEmail: email,
    isGift,
    giftToEmail: (giftInfo as any)?.toEmail,
    giftToName: (giftInfo as any)?.toName,
    emails: notificationEmails,
    phone,
    shippingDetails,
    shippingCost,
    originalPrice,
    bookName,
    amount: amountTotal,
  });
}

export async function updateNFTBookPostCheckoutFeeInfo({
  classId,
  paymentId,
  amountSubtotal,
  amountTotal,
  shippingCost,
  balanceTx,
  feeInfo,
}) {
  const {
    stripeFeeAmount: docStripeFeeAmount,
    priceInDecimal,
  } = feeInfo;
  const stripeFeeDetails = balanceTx.fee_details.find((fee) => fee.type === 'stripe_fee');
  const stripeFeeCurrency = stripeFeeDetails?.currency || 'USD';
  const stripeFeeAmount = stripeFeeDetails?.amount || docStripeFeeAmount || 0;
  const newFeeInfo = { ...feeInfo, stripeFeeAmount };
  const shippingCostAmount = shippingCost ? shippingCost.amount_total : 0;
  const productAmountTotal = amountTotal - shippingCostAmount;
  const shouldUpdateStripeFee = stripeFeeAmount !== docStripeFeeAmount;
  const shouldUpdateAmountFee = priceInDecimal !== productAmountTotal
    && productAmountTotal !== amountSubtotal;
  const discountRate = shouldUpdateAmountFee ? (productAmountTotal / amountSubtotal) : 1;
  if (shouldUpdateAmountFee) {
    [
      'priceInDecimal',
      'likerLandTipFeeAmount',
      'likerLandFeeAmount',
      'likerLandCommission',
      'channelCommission',
      'likerLandArtFee',
      'customPriceDiff',
    ].forEach((key) => {
      if (typeof newFeeInfo[key] === 'number') {
        newFeeInfo[key] = Math.round(newFeeInfo[key] * discountRate);
      }
    });
  }
  if (shouldUpdateStripeFee || shouldUpdateAmountFee) {
    await likeNFTBookCollection.doc(classId).collection('transactions')
      .doc(paymentId).update({
        feeInfo: newFeeInfo,
        shippingCost: shippingCostAmount / 100,
      });
  }
  return {
    ...newFeeInfo,
    stripeFeeCurrency,
  };
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
      userAgent,
      clientIp,
      referrer,
      fbClickId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
    amount_subtotal: amountSubtotal,
    shipping_details: shippingDetails,
    shipping_cost: shippingCost,
  } = session;
  const priceIndex = Number(priceIndexString);
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');

  const { email, phone } = customer;
  let capturedPaymentIntent: Stripe.Response<Stripe.PaymentIntent> | null = null;
  try {
    const { txData, listingData } = await processNFTBookPurchase({
      classId,
      email,
      phone,
      paymentId,
      shippingDetails,
      shippingCost,
    });
    const {
      notificationEmails = [],
      mustClaimToView = false,
      connectedWallets,
      ownerWallet,
    } = listingData;
    const {
      claimToken,
      price,
      priceName,
      type,
      from,
      isGift,
      giftInfo,
      isPhysicalOnly,
      feeInfo: docFeeInfo,
      quantity,
    } = txData;
    const [captured, classData] = await Promise.all([
      stripe.paymentIntents.capture(paymentIntent as string, {
        expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
      }),
      getNFTClassDataById(classId).catch(() => null),
    ]);
    capturedPaymentIntent = captured;
    const className = classData?.name || classId;

    const balanceTx = (capturedPaymentIntent.latest_charge as Stripe.Charge)
      ?.balance_transaction as Stripe.BalanceTransaction;

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
    } = await updateNFTBookPostCheckoutFeeInfo({
      classId,
      paymentId,
      amountSubtotal,
      amountTotal,
      balanceTx,
      feeInfo: docFeeInfo,
      shippingCost,
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
    const chargeId = typeof capturedPaymentIntent.latest_charge === 'string' ? capturedPaymentIntent.latest_charge : capturedPaymentIntent.latest_charge?.id;
    const shippingCostAmount = (shippingCost?.amount_total || 0) / 100;

    const { transfers } = await handleStripeConnectedAccount(
      {
        classId,
        priceIndex,
        paymentId,
        ownerWallet,
        bookName: className,
        buyerEmail: email,
        paymentIntentId: paymentIntent as string,
        shippingCost: shippingCostAmount,
      },
      {
        amountTotal,
        chargeId,
        stripeFeeAmount: Number(stripeFeeAmount),
        likerLandFeeAmount: Number(likerLandFeeAmount),
        likerLandTipFeeAmount: Number(likerLandTipFeeAmount),
        likerLandCommission: Number(likerLandCommission),
        channelCommission: Number(channelCommission),
        likerLandArtFee: Number(likerLandArtFee),
      },
      { connectedWallets, from },
    );

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
    await Promise.all([
      sendNFTBookPurchaseEmail({
        email,
        phone: phone || '',
        shippingDetails,
        shippingCost: shippingCostAmount,
        originalPrice: originalPriceInDecimal / 100,
        isGift,
        giftInfo,
        notificationEmails,
        classId,
        bookName: className,
        priceName,
        paymentId,
        claimToken,
        amountTotal: (amountTotal || 0) / 100,
        mustClaimToView,
        isPhysicalOnly,
        from,
      }),
      sendNFTBookSalesSlackNotification({
        classId,
        bookName: className,
        paymentId,
        email,
        priceName,
        priceWithCurrency: `${price} USD`,
        method: 'Fiat',
        from,
      }),
      createAirtableBookSalesRecordFromStripePaymentIntent({
        pi: capturedPaymentIntent,
        paymentId,
        classId,
        priceIndex,
        from,
        quantity,
        feeInfo,
        transfers,
        shippingCountry: shippingDetails?.address?.country,
        shippingCost: shippingCostAmount,
        stripeFeeCurrency,
        stripeFeeAmount,
      }),
    ]);

    if (email) {
      const segments = ['purchaser'];
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
        productId: classId,
        priceIndex,
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
    if (!capturedPaymentIntent && errorMessage !== 'PAYMENT_ALREADY_PROCESSED') {
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
    isAutoDeliver,
    nftId,
    nftIds,
    autoMemo = '',
    quantity,
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
      const txMessages = msgSendNftIds
        .map((id) => formatMsgSend(LIKER_NFT_TARGET_ADDRESS, wallet, classId, id));
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
        quantity,
        isAutoDeliver,
      }, t);
      msgSendNftIds.forEach((id) => {
        t.update(bookRef.collection('nft').doc(id), {
          ownerWallet: wallet,
          isProcessing: false,
          isSold: true,
        });
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
      nftId,
      txHash,
      isGift,
    });
  }

  return {
    email, nftIds, nftId: nftIds?.[0], txHash,
  };
}

export async function sendNFTBookClaimedEmailNotification(
  classId: string,
  nftId: string,
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
  if (!nftId && notificationEmails && notificationEmails.length) {
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
  quantity = 1,
  isAutoDeliver = false,
}: {
  classId: string,
  callerWallet: string,
  paymentId: string,
  txHash: string,
  quantity?: number,
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
  const { status, isPhysicalOnly, quantity: docQuantity = 1 } = paymentDocData;
  if (quantity !== docQuantity) {
    throw new ValidationError('INVALID_QUANTITY', 400);
  }
  if (status === 'completed') {
    throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
  }
  if (isPhysicalOnly) {
    throw new ValidationError('CANNOT_SEND_PHYSICAL_ONLY', 409);
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
