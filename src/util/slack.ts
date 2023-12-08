import axios from 'axios';

import { getLikerLandNFTClassPageURL } from './liker-land';
import {
  IS_TESTNET,
  LIKER_LAND_HOSTNAME,
} from '../constant';
import {
  NFT_MESSAGE_WEBHOOK,
  NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_NOTIFICATION_WEBHOOK,
  NFT_MESSAGE_SLACK_USER,
} from '../../config/config';

export async function sendStripeFiatPurchaseSlackNotification({
  metadataWallet,
  isPendingClaim,
  isEmailSent,
  wallet,
  email,
  fiatPriceString,
  LIKEPrice,
  paymentId,
  classIds,
}: {
  isPendingClaim: boolean;
  isEmailSent: boolean;
  metadataWallet: string;
  wallet: string;
  email: string;
  fiatPriceString: string;
  LIKEPrice: string;
  paymentId: string;
  classIds: string[];
}) {
  if (!NFT_MESSAGE_WEBHOOK) return;
  try {
    const words: string[] = [];
    if (!wallet && NFT_MESSAGE_SLACK_USER) {
      words.push(`<@${NFT_MESSAGE_SLACK_USER}>`);
    }
    if (IS_TESTNET) {
      words.push('[🚧 TESTNET]');
    }
    let claimState = '';
    if (wallet) {
      claimState = 'A';
    } else {
      claimState = isPendingClaim ? 'An unclaimed' : 'An auto claimed';
    }
    words.push(claimState);
    words.push('NFT is bought');
    if (!wallet) {
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
    ];
    classIds.forEach((c) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*NFT Class*\n<${getLikerLandNFTClassPageURL({ classId: c })}|${c}>`,
        },
      });
    });
    await axios.post(NFT_MESSAGE_WEBHOOK, { text, blocks });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookNewListingSlackNotification({
  wallet,
  classId,
  className,
  currency,
  prices,
  canPayByLIKE,
}) {
  if (!NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK) return;
  try {
    const editions = prices.map(
      (p) => {
        const price = p.priceInDecimal === 0 ? 'FREE' : `${currency} ${p.priceInDecimal / 100}`;
        return `Name: ${Object.values(p.name).join(', ')}; Price: ${price}; Stock: ${p.stock}`;
      },
    ).join('\n');
    await axios.post(NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK, {
      wallet,
      classId,
      className,
      editions,
      canPayByLIKE,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookSalesSlackNotification({
  classId,
  className,
  paymentId,
  method,
}) {
  if (!NFT_BOOK_SALES_NOTIFICATION_WEBHOOK) return;
  try {
    await axios.post(NFT_BOOK_SALES_NOTIFICATION_WEBHOOK, {
      classId,
      className,
      paymentId,
      method,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}
