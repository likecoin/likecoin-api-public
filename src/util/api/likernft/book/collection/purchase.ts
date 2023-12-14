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
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  PUBSUB_TOPIC_MISC,
} from '../../../../../constant';
import { parseImageURLFromMetadata } from '../../metadata';
import {
  formatStripeCheckoutSession, sendNFTBookPurchaseEmail,
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
} from '../../../../ses';
import { sendNFTBookSalesSlackNotification } from '../../../../slack';
import { getBookCollectionInfoById } from '../../collection/book';

export async function createNewNFTBookCollectionPayment(collectionId, paymentId, {
  type,
  email = '',
  claimToken,
  sessionId = '',
  from = '',
  giftInfo,
}) {
  const docData = await getBookCollectionInfoById(collectionId);
  const { priceInDecimal, classIds } = docData;
  const payload: any = {
    type,
    email,
    isPaid: false,
    isPendingClaim: false,
    claimToken,
    sessionId,
    collectionId,
    classIds,
    priceInDecimal,
    price: priceInDecimal / 100,
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
  await likeNFTCollectionCollection.doc(collectionId).collection('transactions').doc(paymentId).create(payload);
}

export async function processNFTBookCollectionPurchase({
  collectionId,
  email,
  paymentId,
  shippingDetails,
  shippingCost,
  execGrantTxHash = '',
}) {
  const hasShipping = !!shippingDetails;
  const { listingData, txData } = await db.runTransaction(async (t) => {
    const collectionRef = likeNFTCollectionCollection.doc(collectionId);
    const doc = await t.get(collectionRef);
    const docData = doc.data();
    if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { typePayload } = docData;
    const { stock } = typePayload;
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');

    const paymentDoc = await t.get(collectionRef.collection('transactions').doc(paymentId));
    const paymentData = paymentDoc.data();
    if (!paymentData) throw new ValidationError('PAYMENT_NOT_FOUND');
    if (paymentData.status !== 'new') throw new ValidationError('PAYMENT_ALREADY_CLAIMED');
    typePayload.stock -= 1;
    typePayload.sold += 1;
    typePayload.lastSaleTimestamp = firestore.Timestamp.now();
    t.update(collectionRef, {
      typePayload,
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
    t.update(collectionRef.collection('transactions').doc(paymentId), paymentPayload);
    return {
      listingData: docData,
      txData: paymentData,
    };
  });
  return { listingData, txData };
}

export async function handleNewNFTBookCollectionStripeCheckout(collectionId: string, {
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
    }) : getLikerLandNFTClaimPageURL({
      collectionId,
      paymentId,
      token: claimToken,
      type: 'nft_book',
      redirect: true,
    }),
    cancelUrl = getLikerLandNFTCollectionPageURL({ collectionId }),
    ownerWallet,
    connectedWallets,
    shippingRates,
    defaultPaymentCurrency = 'USD',
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
    isLikerLandArt,
    priceInDecimal,
    stock,
    hasShipping,
    name: collectionNameObj,
    description: collectionDescriptionObj,
  } = collectionData;
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
  if (priceInDecimal === 0) throw new ValidationError('FREE');
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

  const session = await formatStripeCheckoutSession({
    collectionId,
    paymentId,
    ownerWallet,
    from,
    gaClientId,
  }, {
    name,
    description,
    images,
  }, {
    hasShipping,
    shippingRates,
    defaultPaymentCurrency,
    priceInDecimal,
    connectedWallets,
    isLikerLandArt,
    successUrl,
    cancelUrl,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookCollectionPayment(collectionId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    from: from as string,
    giftInfo,
  });

  return {
    url,
    paymentId,
    name,
    priceInDecimal,
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
    });
  }
  if (notificationEmails.length) {
    await sendNFTBookSalesEmail({
      buyerEmail: email,
      emails: notificationEmails,
      bookName: collectionName,
      isGift,
      giftToEmail: (giftInfo as any)?.toEmail,
      giftToName: (giftInfo as any)?.toName,
      amount: (amountTotal || 0) / 100,
    });
  }
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
  const { email } = customer;
  try {
    const { txData, listingData } = await processNFTBookCollectionPurchase({
      collectionId,
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
      claimToken, price, type, from, isGift, giftInfo,
    } = txData;
    const [, collectionData] = await Promise.all([
      stripe.paymentIntents.capture(paymentIntent as string),
      getBookCollectionInfoById(collectionId),
    ]);

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

    const collectionName = collectionData?.name[NFT_BOOK_TEXT_DEFAULT_LOCALE] || collectionId;
    await Promise.all([
      sendNFTBookPurchaseEmail({
        email,
        isGift,
        giftInfo,
        notificationEmails,
        collectionId,
        bookName: collectionName,
        paymentId,
        claimToken,
        amountTotal,
        mustClaimToView,
      }),
      sendNFTBookSalesSlackNotification({
        collectionId,
        bookName: collectionName,
        paymentId,
        email,
        priceName: collectionName,
        priceWithCurrency: `${price} ${defaultPaymentCurrency || 'USD'}`,
        method: 'USD',
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
      bookName: name[NFT_BOOK_TEXT_DEFAULT_LOCALE],
      fromEmail: email,
      fromName,
      toName,
    });
  }
}
