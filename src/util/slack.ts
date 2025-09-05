import axios from 'axios';

import { getLikerLandNFTClassPageURL, getLikerLandNFTCollectionPageURL } from './liker-land';
import { getNFTBookStoreCollectionSendPageURL, getNFTBookStoreSendPageURL } from './api/likernft/book';
import {
  BOOK3_HOSTNAME,
  IS_TESTNET,
  LIKER_LAND_HOSTNAME,
} from '../constant';
import {
  NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK,
  PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK,
} from '../../config/config';
import { Timestamp } from './firebase';

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

export async function sendPlusSubscriptionSlackNotification({
  subscriptionId,
  email,
  priceWithCurrency,
  isNew,
  userId,
  stripeCustomerId,
  method = 'stripe',
  isTrial = false,
} : {
  subscriptionId: string;
  email: string;
  priceWithCurrency: string;
  isNew: boolean;
  userId?: string;
  stripeCustomerId?: string;
  method?: string;
  isTrial?: boolean;
}) {
  if (!PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK) return;
  try {
    let subscriptionType = '';
    if (isTrial) {
      subscriptionType = 'New Plus trial subscription';
    } else if (isNew) {
      subscriptionType = 'New Plus subscription';
    } else {
      subscriptionType = 'Plus subscription renewal';
    }
    const userLink = userId ? `<https://${LIKER_LAND_HOSTNAME}/${userId}|${userId}>` : 'N/A';
    const stripeEnvironment = IS_TESTNET ? 'test' : '';
    const customerLink = stripeCustomerId ? `<https://dashboard.stripe.com/${stripeEnvironment}/customers/${stripeCustomerId}|${stripeCustomerId}>` : 'N/A';
    const subscriptionLink = `<https://dashboard.stripe.com/${stripeEnvironment}/subscriptions/${subscriptionId}|${subscriptionId}>`;

    await axios.post(PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      subscriptionType,
      subscriptionId: subscriptionLink,
      email,
      userId: userLink,
      stripeCustomerId: customerLink,
      priceWithCurrency,
      method,
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

function formatValueRecursively(key, value, depth = 0): string {
  const indent = '  '.repeat(depth);
  switch (key) {
    case 'evmWallet':
      return `<https://${BOOK3_HOSTNAME}/shelf/${value}|${value}>`;
    case 'likeWallet':
      return `<https://${LIKER_LAND_HOSTNAME}/${value}|${value}>`;
    default:
  }
  switch (typeof value) {
    case 'object': {
      if (Array.isArray(value)) {
        return value.map((item) => formatValueRecursively(key, item, depth)).join(', ');
      } if (value instanceof Timestamp) {
        return value.toDate().toISOString();
      } if (value === null) {
        return 'null';
      }
      const entries = Object.entries(value);
      if (entries.length === 0) return '{}';

      const formattedEntries = entries.map(([subKey, val]) => `${indent}  ${subKey}: ${formatValueRecursively(subKey, val, depth + 1)}`);
      return `{\n${formattedEntries.join('\n')}\n${indent}}`;
    }
    case 'number':
      if (value > new Date('2020-01-01').getTime()) {
        return new Date(value).toISOString();
      }
      return String(value);
    default:
      return String(value);
  }
}

export function getSlackAttachmentForMap(title, map) {
  const orderedKeys = [
    'user',
    'evmWallet',
    'magicUserId',
    'email',
    'isEmailVerified',
    'isLikerPlus',
    'likerPlusSince',
    'civicLikerStatus',
  ];

  const orderedValues = orderedKeys.filter((key) => key in map);
  const otherValues = Object.keys(map).filter((key) => !orderedKeys.includes(key));
  const fields = orderedValues.concat(otherValues).map((key) => {
    const formattedValue = formatValueRecursively(key, map[key]);
    return {
      title: key,
      value: formattedValue,
    };
  });

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
    wallet, txHash,
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

  if (wallet) {
    fields.push({
      type: 'mrkdwn',
      text: `*Wallet*\n<https://liker.land/${wallet}|${wallet}>`,
    });
  }
  if (txHash) {
    fields.push({
      type: 'mrkdwn',
      text: `*Tx Hash*\n\`${txHash}\``,
    });
  }

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
