import Stripe from 'stripe';
import { firestore } from 'firebase-admin';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';

import { ValidationError } from '../../../../ValidationError';
import {
  PUBSUB_TOPIC_MISC,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../../constant';
import {
  TransactionFeeInfo,
  calculateFeeAndDiscountFromBalanceTx,
  handleStripeConnectedAccount,
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
    originalPrice: originalPriceInDecimal / 100,
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
  const {
    isStripeFeeUpdated,
    isAmountFeeUpdated,
    stripeFeeCurrency,
    newFeeInfo,
    priceInDecimal,
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
      priceInDecimal,
      price: priceInDecimal / 100,
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
    const { isGift, giftInfo } = await db.runTransaction(async (t) => {
      // eslint-disable-next-line no-use-before-define
      const paymentDocData = await updateNFTBookCollectionPostDeliveryData({
        collectionId,
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
      const bookDoc = await bookRef.get();
      const { name } = bookDoc.data();
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
  paymentId,
  txHash,
  quantity = 1,
  isAutoDeliver = false,
}: {
  collectionId: string,
  paymentId: string,
  txHash: string,
  quantity?: number,
  isAutoDeliver?: boolean,
}, t: any) {
  // TODO: check tx content contains valid nft info and address
  const collectionRef = likeNFTCollectionCollection.doc(collectionId);
  const paymentDocRef = collectionRef.collection('transactions').doc(paymentId);
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
  return docData;
}
