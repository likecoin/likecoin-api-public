import BigNumber from 'bignumber.js';
import Stripe from 'stripe';
import stripe from '../../../stripe';
import { likeNFTFiatCollection } from '../../../firebase';
import { ValidationError } from '../../../ValidationError';
import { processFiatNFTPurchase } from '.';
import {
  API_EXTERNAL_HOSTNAME,
  PUBSUB_TOPIC_MISC,
} from '../../../../constant';
import publisher from '../../../gcloudPub';
import { sendPendingClaimEmail, sendAutoClaimEmail } from '../../../ses';
import { getNFTISCNData } from '../../../cosmos/nft';
import {
  LIKER_NFT_PENDING_CLAIM_ADDRESS,
} from '../../../../../config/config';
import { sendStripeFiatPurchaseSlackNotification } from '../../../slack';
import { DEFAULT_NFT_IMAGE_SIZE, checkIsWritingNFT, parseImageURLFromMetadata } from '../metadata';
import { subscribeEmailToLikerLandSubstack } from '../../../substack';
import { findLikerLandWalletUserWithVerifiedEmail } from '../../../liker-land';

export async function findPaymentFromStripeSessionId(sessionId) {
  const query = await likeNFTFiatCollection.where('sessionId', '==', sessionId).limit(1).get();
  const [doc] = query.docs;
  return doc;
}

export async function processStripeFiatNFTPurchase(session, req) {
  const {
    id: sessionId,
    subscription: subscriptionId,
    metadata = {},
    customer_details: customer = {},
  } = session;
  if (subscriptionId) return false;
  const doc = await findPaymentFromStripeSessionId(sessionId);
  if (!doc) throw new ValidationError('PAYMENT_SESSION_NOT_FOUND');
  const docData = doc.data();
  if (!docData) throw new ValidationError('PAYMENT_SESSION_NOT_FOUND');
  const {
    type,
    memo,
    LIKEPrice,
    fiatPrice,
    purchaseInfoList,
    fiatPriceString,
    status,
  } = docData;
  let { wallet } = docData;
  const paymentId = doc.id;
  if (type !== 'stripe') throw new ValidationError('PAYMENT_TYPE_NOT_STRIPE');
  if (status !== 'new') return true; // handled or handling
  const { email } = customer;
  const isWalletProvided = !!wallet;
  if (!isWalletProvided && email) {
    const user = await findLikerLandWalletUserWithVerifiedEmail(email);
    if (user && user.wallet) {
      wallet = user.wallet;
    }
  }
  const isPendingClaim = !wallet;
  let claimToken: string | undefined;
  if (isPendingClaim) {
    wallet = LIKER_NFT_PENDING_CLAIM_ADDRESS;
    if (docData.claimToken) {
      claimToken = docData.claimToken;
    } else {
      throw new ValidationError('CLAIM_TOKEN_NOT_FOUND');
    }
  }
  try {
    await processFiatNFTPurchase({
      paymentId,
      likeWallet: wallet,
      purchaseInfoList,
      LIKEPrice,
      fiatPrice,
      memo,
      email,
      claimToken,
    }, req);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentError',
      type: 'stripe',
      paymentId,
      buyerWallet: wallet,
      purchaseInfoList,
      fiatPrice,
      LIKEPrice,
      sessionId,
      error: (error as Error).toString(),
      errorMessage,
      errorStack,
    });
    return false;
  }
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'LikerNFTFiatPaymentCaptured',
    type: 'stripe',
    paymentId,
    buyerWallet: wallet,
    purchaseInfoList,
    fiatPrice,
    LIKEPrice,
    sessionId,
  });
  let isEmailSent = false;
  const classIds = purchaseInfoList.map((info) => info.classId);
  const iscnPrefixes = purchaseInfoList.map((info) => info.iscnPrefix);
  if (!isWalletProvided) {
    try {
      const firstISCNData = await getNFTISCNData(iscnPrefixes[0]);
      const firstClassName = firstISCNData.data?.contentMetadata.name;
      if (isPendingClaim) {
        await sendPendingClaimEmail({
          email,
          classIds,
          firstClassName,
          paymentId,
          claimToken,
        });
      } else {
        await sendAutoClaimEmail({
          email,
          classIds,
          firstClassName,
          wallet,
        });
      }
      isEmailSent = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to send ${isPendingClaim ? 'pending' : 'auto'} claim email for ${classIds.length > 1
        ? classIds.join(', ') : classIds[0]} to ${email}`);
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  await sendStripeFiatPurchaseSlackNotification({
    isPendingClaim,
    isEmailSent,
    metadataWallet: metadata.wallet,
    wallet,
    email,
    fiatPriceString,
    LIKEPrice,
    paymentId,
    classIds,
  });
  return true;
}

export async function handlePromotionalEmails(session: Stripe.Checkout.Session, req) {
  const promoConsent = session.consent?.promotions;
  if (promoConsent) {
    const email = session.customer_details?.email;
    if (email) {
      try {
        await subscribeEmailToLikerLandSubstack(email);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatPromoConsent',
        email,
      });
    }
  }
}

function getImage(classMetadata) {
  let { image = '' } = classMetadata.data.metadata;
  const { is_custom_image: isCustomImage = false } = classMetadata;
  if (checkIsWritingNFT(classMetadata) && !isCustomImage) {
    const classId = classMetadata.id;
    image = `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}?size=${DEFAULT_NFT_IMAGE_SIZE}`;
  } else {
    image = parseImageURLFromMetadata(image);
  }
  if (!image) {
    image = 'https://static.like.co/primitive-nft.jpg';
  }
  return image;
}

export function formatLineItem(classMetadata, fiatPrice) {
  const { id: classId, name, description } = classMetadata;
  const { iscnPrefix } = classMetadata.data.parent;
  const image = getImage(classMetadata);
  let formattedDescription = description.length > 200 ? `${description.substring(0, 199)}…` : description;
  // stripe does not like empty string
  if (!formattedDescription) { formattedDescription = undefined; }
  return {
    price_data: {
      currency: 'usd',
      product_data: {
        name,
        description: formattedDescription,
        images: [image],
        metadata: {
          iscnPrefix,
          classId,
        },
      },
      unit_amount: Number(new BigNumber(fiatPrice).shiftedBy(2).toFixed(0)),
    },
    adjustable_quantity: {
      enabled: false,
    },
    quantity: 1,
  };
}
