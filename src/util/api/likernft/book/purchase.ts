import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { firestore } from 'firebase-admin';

import { formatMsgExecSendAuthorization } from '@likecoin/iscn-js/dist/messages/authz';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import BigNumber from 'bignumber.js';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { ValidationError } from '../../../ValidationError';
import {
  LIST_OF_BOOK_SHIPPING_COUNTRY,
  PUBSUB_TOPIC_MISC,
  LIKER_LAND_WAIVED_CHANNEL,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../constant';
import { calculateStripeFee, checkIsFromLikerLand, handleNFTPurchaseTransaction } from '../purchase';
import {
  getBookUserInfo, getBookUserInfoFromLegacyString, getBookUserInfoFromLikerId,
} from './user';
import stripe, { getStripePromotionFromCode, getStripePromotoionCodesFromCheckoutSession } from '../../../stripe';
import {
  likeNFTBookCollection, FieldValue, db, likeNFTBookUserCollection,
} from '../../../firebase';
import publisher from '../../../gcloudPub';
import { calculateTxGasFee } from '../../../cosmos/tx';
import { sendNFTBookInvalidChannelIdSlackNotification } from '../../../slack';
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
import { getUserWithCivicLikerPropertiesByWallet } from '../../users/getPublicInfo';
import { CartItemWithInfo } from './type';

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
  stripePriceId?: string;
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
  shippingCostAmountInDecimal,
}: {
  classId?: string,
  collectionId?: string,
  priceIndex?: number,
  paymentId: string,
  ownerWallet: string,
  bookName: string,
  buyerEmail: string | null,
  paymentIntentId: string,
  shippingCostAmountInDecimal?: number,
}, {
  chargeId = '',
  amountTotal,
  stripeFeeAmount = 0,
  likerLandFeeAmount = 0,
  likerLandTipFeeAmount = 0,
  likerLandCommission = 0,
  likerLandArtFee = 0,
  channelCommission = 0,
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
            const {
              stripeConnectAccountId,
              isEnableNotificationEmails = true,
            } = userInfo;
            const currency = 'usd'; // stripe balance are setteled in USD in source tx
            const amountSplit = Math.floor((amountToSplit * connectedWallets[wallet]) / totalSplit);
            const shippingCostSplit = Math.floor(
              ((shippingCostAmountInDecimal || 0) * connectedWallets[wallet]) / totalSplit,
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
  isPhysicalOnly = false,
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
  phone,
  shippingDetails,
  shippingCostAmount,
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
    hasShipping,
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
  if (hasShipping) {
    paymentPayload.shippingStatus = 'pending';
    if (shippingDetails) paymentPayload.shippingDetails = shippingDetails;
    if (shippingCostAmount) paymentPayload.shippingCost = shippingCostAmount;
  }
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
  shippingCostAmount,
  execGrantTxHash = '',
}) {
  const data = await db.runTransaction(async (t) => {
    const {
      txData,
      listingData,
    } = await processNFTBookPurchaseTxGet(t, classId, paymentId, {
      email,
      phone,
      shippingDetails,
      shippingCostAmount,
      execGrantTxHash,
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

function calculateItemPrices(items: CartItemWithInfo[], from) {
  const itemPrices: ItemPriceInfo[] = items.map(
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
  collectionId,
  paymentId,
  priceIndex,
  email,
  likeWallet,
  customerId,
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
  likeWallet?: string,
  customerId?: string,
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
}, items: CartItemWithInfo[], {
  successUrl,
  cancelUrl,
  paymentMethods,
}: {
  successUrl: string,
  cancelUrl: string,
  paymentMethods?: string[],
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
  if (referrer) sessionMetadata.referrer = referrer.substring(0, 500);
  if (userAgent) sessionMetadata.userAgent = userAgent;
  if (clientIp) sessionMetadata.clientIp = clientIp;
  if (fbClickId) sessionMetadata.fbClickId = fbClickId;
  if (likeWallet) sessionMetadata.likeWallet = likeWallet;

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
    }
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
  if (paymentMethods) {
    checkoutPayload.payment_method_types = paymentMethods as
      Stripe.Checkout.SessionCreateParams.PaymentMethodType[];
  }
  if (promotion) {
    checkoutPayload.discounts = [{ promotion_code: promotion.id }];
  } else {
    checkoutPayload.allow_promotion_codes = true;
  }
  if (likeWallet) {
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
  const itemWithShipping = itemWithPrices.find((item) => item.hasShipping);

  if (itemWithShipping) {
    checkoutPayload.shipping_address_collection = {
      // eslint-disable-next-line max-len
      allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
    checkoutPayload.phone_number_collection = { enabled: true };
    if (itemWithShipping.shippingRates) {
      checkoutPayload.shipping_options = itemWithShipping.shippingRates
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
  quantity,
  isGift = false,
  giftInfo,
  mustClaimToView = false,
  isPhysicalOnly = false,
  shippingDetails,
  phone = '',
  shippingCostAmount = 0,
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
    });
  } else if (email) {
    await sendNFTBookPendingClaimEmail({
      email,
      classId,
      collectionId,
      bookName,
      paymentId,
      claimToken,
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
    shippingCostAmount,
    originalPrice,
    bookName,
    amount: amountTotal,
    quantity,
  });
}

export const DISCOUNTED_FEE_TYPES = [
  'priceInDecimal',
  'likerLandTipFeeAmount',
  'customPriceDiff',
];

export function calculateCommissionWithDiscount({
  paymentId,
  commission,
  originalPriceInDecimal,
  discountRate,
}) {
  const originalRate = commission / originalPriceInDecimal;
  const discountedRate = originalRate - (1 - discountRate);
  if (discountedRate < 0) {
    // eslint-disable-next-line no-console
    console.error(`Negative commission rate ${discountedRate} for paymentId: ${paymentId}`);
    return 0;
  }
  return Math.floor(originalPriceInDecimal * discountedRate);
}

export function calculateFeeAndDiscountFromBalanceTx({
  paymentId,
  amountSubtotal,
  amountTotal,
  shippingCostAmount,
  balanceTx,
  feeInfo,
}) {
  const {
    stripeFeeAmount: docStripeFeeAmount,
    channelCommission,
    likerLandCommission,
    priceInDecimal,
    originalPriceInDecimal,
  } = feeInfo as TransactionFeeInfo;
  let newFeeInfo = { ...feeInfo };
  let stripeFeeAmount = docStripeFeeAmount;
  let stripeFeeCurrency = 'USD';
  if (balanceTx) {
    const stripeFeeDetails = balanceTx.fee_details.find((fee) => fee.type === 'stripe_fee');
    stripeFeeCurrency = stripeFeeDetails?.currency || 'USD';
    stripeFeeAmount = stripeFeeDetails?.amount || docStripeFeeAmount || 0;
  } else {
    stripeFeeAmount = 0;
  }
  const isStripeFeeUpdated = stripeFeeAmount !== docStripeFeeAmount;
  if (isStripeFeeUpdated) {
    newFeeInfo = {
      ...newFeeInfo,
      stripeFeeAmount,
    };
  }
  const productAmountTotal = amountTotal - (shippingCostAmount * 100);
  const isAmountFeeUpdated = priceInDecimal !== productAmountTotal
    && productAmountTotal !== amountSubtotal;
  const discountRate = isAmountFeeUpdated ? (productAmountTotal / amountSubtotal) : 1;
  const totalDiscountAmount = amountSubtotal - productAmountTotal;
  const originalPriceDiscountAmount = Math.ceil(discountRate * originalPriceInDecimal);
  if (isAmountFeeUpdated) {
    DISCOUNTED_FEE_TYPES.forEach((key) => {
      if (typeof newFeeInfo[key] === 'number') {
        newFeeInfo[key] = Math.round(newFeeInfo[key] * discountRate);
      }
    });
    if (channelCommission) {
      newFeeInfo.channelCommission = calculateCommissionWithDiscount({
        paymentId,
        commission: channelCommission,
        originalPriceInDecimal,
        discountRate,
      });
    } else if (likerLandCommission) {
      newFeeInfo.likerLandCommission = calculateCommissionWithDiscount({
        paymentId,
        commission: likerLandCommission,
        originalPriceInDecimal,
        discountRate,
      });
    } else {
      // eslint-disable-next-line no-console
      console.error(`Discount amount ${totalDiscountAmount} but no commission found for paymentId: ${paymentId}`);
    }
  }
  return {
    newFeeInfo,
    stripeFeeCurrency,
    totalDiscountAmount,
    originalPriceDiscountAmount,
    discountRate,
    isStripeFeeUpdated,
    isAmountFeeUpdated,
    priceInDecimal: newFeeInfo.priceInDecimal,
    originalPriceInDecimal,
  };
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
    if (!docData.isAutoDeliver || docData.hasShipping) {
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
        isPendingClaim: true,
        status: 'paid',
        wallet: '',
        message: '',
        lastError: (autoDeliverErr as Error).toString(),
      });
      throw autoDeliverErr;
    }

    const { isGift, giftInfo } = await db.runTransaction(async (t) => {
      // eslint-disable-next-line no-use-before-define
      const paymentDocData = await updateNFTBookPostDeliveryData({
        classId,
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
      email,
      fromWallet: req.user?.wallet,
      toWallet: wallet,
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
  const isPendingShipping = paymentDocData.hasShipping && paymentDocData.shippingStatus !== 'completed';
  if (status === 'pendingNFT' && !isAutoDeliver && !isPendingShipping) {
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
