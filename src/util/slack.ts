import axios from 'axios';

import { getLikerLandNFTClassPageURL, getLikerLandNFTCollectionPageURL } from './liker-land';
import { getNFTBookStoreCollectionSendPageURL, getNFTBookStoreSendPageURL } from './api/likernft/book';
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
  prices,
  canPayByLIKE,
}: {
  wallet: string;
  classId: string;
  className: string;
  prices: {
    name: Record<string, string>;
    priceInDecimal: number;
    stock: number;
  }[];
  canPayByLIKE: boolean;
}) {
  if (!NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = getLikerLandNFTClassPageURL({ classId });
    const editions = prices.map(
      (p) => {
        const priceWithCurrency = p.priceInDecimal === 0 ? 'FREE' : `${p.priceInDecimal / 100} USD}`;
        return `Name: ${Object.values(p.name).join(', ')}; Price: ${priceWithCurrency}; Stock: ${p.stock}`;
      },
    ).join('\n');
    await axios.post(NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      wallet,
      className,
      classLink,
      editions,
      canPayByLIKE,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookSalesSlackNotification({
  classId = '',
  collectionId,
  bookName,
  paymentId,
  email,
  priceName,
  priceWithCurrency,
  method,
  from = '',
} : {
  classId?: string;
  collectionId?: string;
  bookName: string;
  paymentId: string;
  email: string | null;
  priceName: string;
  priceWithCurrency: string;
  method: string;
  from?: string;
}) {
  if (!NFT_BOOK_SALES_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = collectionId
      ? getLikerLandNFTCollectionPageURL({ collectionId })
      : getLikerLandNFTClassPageURL({ classId });
    const paymentLink = collectionId
      ? getNFTBookStoreCollectionSendPageURL(collectionId, paymentId)
      : getNFTBookStoreSendPageURL(classId, paymentId);
    await axios.post(NFT_BOOK_SALES_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      className: bookName,
      classLink,
      email: email || 'N/A',
      paymentLink,
      priceName,
      priceWithCurrency,
      method,
      from,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}
