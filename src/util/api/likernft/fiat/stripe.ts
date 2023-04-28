import uuidv4 from 'uuid/v4';
import BigNumber from 'bignumber.js';
import axios from 'axios';
import stripe from '../../../stripe';
import { likeNFTFiatCollection } from '../../../firebase';
import { ValidationError } from '../../../ValidationError';
import { processFiatNFTPurchase } from '.';
import { IS_TESTNET, LIKER_LAND_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../../constant';
import publisher from '../../../gcloudPub';
import { sendPendingClaimEmail, sendAutoClaimEmail } from '../../../ses';
import { getNFTISCNData } from '../../../cosmos/nft';
import {
  LIKER_NFT_PENDING_CLAIM_ADDRESS,
  NFT_MESSAGE_WEBHOOK,
  NFT_MESSAGE_SLACK_USER,
  LIKER_LAND_GET_WALLET_SECRET,
} from '../../../../../config/config';

export async function findPaymentFromStripeSessionId(sessionId) {
  const query = await likeNFTFiatCollection.where('sessionId', '==', sessionId).limit(1).get();
  const [doc] = query.docs;
  return doc;
}

async function findWalletWithVerifiedEmail(email) {
  try {
    const { data } = await axios.get(`https://${LIKER_LAND_HOSTNAME}/api/v2/users/wallet`, {
      headers: { 'x-likerland-api-key': LIKER_LAND_GET_WALLET_SECRET },
      params: { email },
    });
    return data.wallet;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    return null;
  }
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
    classId,
    isListing,
    nftId,
    seller,
    memo,
    iscnPrefix,
    LIKEPrice,
    fiatPrice,
    fiatPriceString,
    status,
  } = docData;
  let { wallet } = docData;
  const paymentId = doc.id;
  if (type !== 'stripe') throw new ValidationError('PAYMENT_TYPE_NOT_STRIPE');
  if (status !== 'new') return true; // handled or handling
  const fiatAmount = new BigNumber(fiatPriceString).shiftedBy(2);
  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
  if (fiatAmount.gt(paymentIntent.amount_capturable)) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentError',
      type: 'stripe',
      paymentId,
      buyerWallet: wallet,
      classId,
      iscnPrefix,
      fiatPrice,
      LIKEPrice,
      sessionId,
      error: 'ALREADY_CAPTURED',
    });
    throw new ValidationError('ALREADY_CAPTURED');
  }
  const { email } = customer;
  const isWalletProvided = !!wallet;
  if (!isWalletProvided && email) {
    wallet = await findWalletWithVerifiedEmail(email);
  }
  const isPendingClaim = !wallet;
  let claimToken;
  if (isPendingClaim) {
    wallet = LIKER_NFT_PENDING_CLAIM_ADDRESS;
    claimToken = uuidv4();
  }
  try {
    await processFiatNFTPurchase({
      paymentId,
      likeWallet: wallet,
      iscnPrefix,
      classId,
      isListing,
      nftId,
      seller,
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
      classId,
      iscnPrefix,
      fiatPrice,
      LIKEPrice,
      sessionId,
      error: (error as Error).toString(),
      errorMessage,
      errorStack,
    });
    if (error instanceof ValidationError) {
      try {
        await stripe.paymentIntents.cancel(session.payment_intent);
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTFiatPaymentCancel',
          type: 'stripe',
          paymentId,
          buyerWallet: wallet,
          classId,
          iscnPrefix,
          fiatPrice,
          LIKEPrice,
          sessionId,
          error: (error as Error).toString(),
          errorMessage,
          errorStack,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
    return false;
  }
  await stripe.paymentIntents.capture(session.payment_intent, {
    amount_to_capture: fiatAmount.toNumber(),
  });
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'LikerNFTFiatPaymentCaptured',
    type: 'stripe',
    paymentId,
    buyerWallet: wallet,
    classId,
    iscnPrefix,
    fiatPrice,
    LIKEPrice,
    sessionId,
  });
  let isEmailSent = false;
  if (!isWalletProvided) {
    try {
      const iscnData = await getNFTISCNData(iscnPrefix);
      const className = iscnData.data?.contentMetadata.name;
      if (isPendingClaim) {
        await sendPendingClaimEmail({
          email,
          classId,
          className,
          paymentId,
          claimToken,
        });
      } else {
        await sendAutoClaimEmail({
          email,
          classId,
          className,
          wallet,
        });
      }
      isEmailSent = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to send ${isPendingClaim ? 'pending' : 'auto'} claim email for ${classId} to ${email}`);
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  if (NFT_MESSAGE_WEBHOOK) {
    try {
      const {
        wallet: metadataWallet,
        // iscnPrefix,
        // paymentId,
      } = metadata;
      const words: string[] = [];
      if (!isWalletProvided && NFT_MESSAGE_SLACK_USER) {
        words.push(`<@${NFT_MESSAGE_SLACK_USER}>`);
      }
      if (IS_TESTNET) {
        words.push('[🚧 TESTNET]');
      }
      let claimState = '';
      if (isWalletProvided) {
        claimState = 'A';
      } else {
        claimState = isPendingClaim ? 'An unclaimed' : 'An auto claimed';
      }
      words.push(claimState);
      words.push('NFT is bought');
      if (!isWalletProvided) {
        words.push(isEmailSent ? 'and email is sent' : 'but email sending failed');
      }
      const text = words.join(' ');

      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: metadataWallet ? `*Wallet*\n<https://${LIKER_LAND_HOSTNAME}/${wallet}|${wallet}>` : `*Email*\n${email}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Price*\nUSD ${fiatPriceString} (${LIKEPrice} LIKE)`,
            },
            {
              type: 'mrkdwn',
              text: `*Payment ID*\n${paymentId}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*NFT Class*\n<https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}|${classId}>`,
          },
        },
      ];

      await axios.post(NFT_MESSAGE_WEBHOOK, { text, blocks });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  return true;
}
