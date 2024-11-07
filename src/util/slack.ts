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
  NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK,
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
}: {
  wallet: string;
  classId: string;
  className: string;
  prices: {
    name: Record<string, string>;
    priceInDecimal: number;
    stock: number;
  }[];
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

export async function sendNFTBookInvalidChannelIdSlackNotification({
  classId = '',
  collectionId,
  bookName,
  email,
  from = '',
  hasStripeAccount = false,
  isStripeConnectReady = false,
  isInvalidChannelId = false,
  paymentId,
  paymentIntentId,
} : {
  classId?: string;
  collectionId?: string;
  bookName: string;
  email: string | null;
  from?: string;
  hasStripeAccount?: boolean;
  isStripeConnectReady?: boolean;
  isInvalidChannelId?: boolean;
  paymentId?: string;
  paymentIntentId?: string;
}) {
  if (!NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = collectionId
      ? getLikerLandNFTCollectionPageURL({ collectionId })
      : getLikerLandNFTClassPageURL({ classId });
    await axios.post(NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',

      channelId: from,
      isValidChannelId: !isInvalidChannelId,
      hasStripeAccount,
      isStripeConnectReady,

      className: bookName,
      classLink,
      email: email || 'N/A',
      paymentId,
      paymentIntentId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookOutOfStockSlackNotification({
  priceIndex,
  notificationEmails,
  classId = '',
  collectionId = '',
  wallet,
  className,
  stock,
  priceName,
}: {
  wallet: string;
  classId?: string;
  collectionId?: string;
  className: string;
  priceIndex: number;
  notificationEmails: string[];
  stock: number;
  priceName: string;
}) {
  if (!NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = collectionId
      ? getLikerLandNFTCollectionPageURL({ collectionId })
      : getLikerLandNFTClassPageURL({ classId });
    await axios.post(NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      priceIndex,
      email: notificationEmails.join(' '),
      classLink,
      wallet,
      className,
      stock,
      priceName,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export function getSlackAttachmentFromError(errMessage) {
  return {
    color: 'danger',
    title: 'Command failed',
    text: `${errMessage}`,
  };
}

export function getSlackAttachmentFromSubscriptionInfo(id, info) {
  const fields = [
    {
      title: 'Type',
      value: info.currentType,
    },
    {
      title: 'Start Date',
      value: `<!date^${Math.trunc(info.currentPeriodStart / 1000)}^{date_num} {time_secs}|${info.currentPeriodStart}>`,
    },
    {
      title: 'End Date',
      value: `<!date^${Math.trunc(info.currentPeriodEnd / 1000)}^{date_num} {time_secs}|${info.currentPeriodEnd}>`,
    },
    {
      title: 'Remaining LIKE',
      value: info.LIKE,
      short: true,
    },
    {
      title: 'Period LIKE',
      value: info.periodTotalLIKE,
      short: true,
    },
    {
      title: 'LIKE to USD',
      value: info.LIKEUSD,
      short: true,
    },
  ];
  if (info.yearPeriodEnd) {
    fields.push({
      title: 'Year End Date',
      value: `<!date^${Math.trunc(info.yearPeriodEnd / 1000)}^{date_num} {time_secs}|${info.yearPeriodEnd}>`,
    });
  }
  return {
    color: '#40bfa5',
    pretext: `*Subscription info of* \`${id}\``,
    fields,
    mrkdwn_in: ['pretext', 'fields'],
  };
}

export function getSlackAttachmentForMap(title, map) {
  const fields = Object.entries(
    map,
  ).map(([key, value]) => ({
    title: key,
    value: JSON.stringify(value, null, 2),
  }));
  return {
    color: '#40bfa5',
    pretext: `*${title}*`,
    fields,
    mrkdwn_in: ['pretext', 'fields'],
  };
}

export function formatTransactionDetailsForBlockKit(data) {
  const {
    timestamp, id: paymentId, classId, sessionId,
    claimToken, from, priceInDecimal: price, status, email,
  } = data;

  const text = `*Payment ID*\n<https://dashboard.stripe.com/test/search?query=${paymentId}|${paymentId}>\n\n*Class ID*\n<https://liker.land/nft/class/${classId}|${classId}>\n\n*Session ID*\n\`${sessionId}\`\n\n*Claim Token*\n\`${claimToken}\``;

  const fields = [
    {
      type: 'mrkdwn',
      text: `*Timestamp*\n${timestamp.toDate().toLocaleString()}`,
    },
    {
      type: 'mrkdwn',
      text: `*Email*\n${email}`,
    },
    {
      type: 'mrkdwn',
      text: `*Price*\n${price}`,
    },
    {
      type: 'mrkdwn',
      text: `*Status*\n${status}`,
    },
    {
      type: 'mrkdwn',
      text: `*Channel*\n\`${from}\``,
    },
  ];

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
    fields,
  };
}

export function mapTransactionDocsToSlackSections(transactionDocs) {
  return transactionDocs.map((doc, index) => ({
    ...formatTransactionDetailsForBlockKit({
      ...doc.data(),
      id: doc.id,
    }),
    text: {
      type: 'mrkdwn',
      text: `💳 *Payment Record #${index + 1}*\n\n${formatTransactionDetailsForBlockKit({
        ...doc.data(),
        id: doc.id,
      }).text.text}`,
    },
  }));
}

export function createPaymentSlackBlocks({
  transactions,
  emailOrWallet = '',
  classId = '',
  collectionId = '',
  cartId = '',
  paymentId = '',
  status = '',
}) {
  const contextArray = [
    emailOrWallet && `for ${emailOrWallet}`,
    classId && `in class ${classId}`,
    collectionId && `in collection ${collectionId}`,
    cartId && `in cart ${cartId}`,
    paymentId && `for payment ${paymentId}`,
    status && `with status ${status}`,
  ].filter(Boolean);

  const titleText = `*${transactions.length} transaction(s) found ${contextArray.join(' ')}*`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: titleText,
      },
    },
    {
      type: 'divider',
    },
    ...transactions,
  ];

  return blocks;
}
