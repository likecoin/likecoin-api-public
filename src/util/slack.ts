import axios from 'axios';

import { getBook3NFTClassPageURL } from './liker-land';
import { getNFTBookStoreSendPageURL } from './api/likernft/book';
import {
  BOOK3_HOSTNAME,
  IS_TESTNET,
} from '../constant';
import {
  NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK,
  NFT_BOOK_SALES_TRANSFER_FAILED_NOTIFICATION_WEBHOOK,
  PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK,
} from '../../config/config';
import { Timestamp } from './firebase';
import {
  FORCE_PING_REVIEW_ACTIONS,
  type BookComplianceReviewOutcome,
} from './api/likernft/book/complianceReview';
import type { CommissionType, NFTBookPrice } from '../types/book';
import type { LikerPlusProvider } from '../types/user';

// RevenueCat has no per-customer URL without a project id, so link to the
// dashboard and search there for the transaction id shown in the message.
const REVENUECAT_DASHBOARD_URL = 'https://app.revenuecat.com/';

// Slack parses mrkdwn in workflow variables, so `<!channel>`-style sequences in
// AI output derived from user metadata could ping the channel or spoof a link.
// Escaping the three reserved characters keeps the text readable but inert.
function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendNFTBookNewListingSlackNotification({
  wallet,
  classId,
  className,
  prices,
  isAutoApproved = false,
  isAdultOnly = false,
  fileRecords,
  contentFingerprints,
  aiReview,
}: {
  wallet: string;
  classId: string;
  className: string;
  prices: NFTBookPrice[];
  isAutoApproved?: boolean;
  isAdultOnly?: boolean;
  fileRecords?: {
    url: string;
    name?: string;
    contentType?: string;
    isEncrypted?: boolean;
  }[];
  contentFingerprints?: string[];
  aiReview?: BookComplianceReviewOutcome;
}) {
  if (!NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = getBook3NFTClassPageURL({ classId });
    const editions = prices.map(
      (p) => {
        const priceWithCurrency = p.priceInDecimal === 0 ? 'FREE' : `${p.priceInDecimal / 100} USD`;
        return `Name: ${Object.values(p.name || {}).join(', ')}; Price: ${priceWithCurrency}; Stock: ${p.stock}`;
      },
    ).join('\n');

    const completedVerdict = aiReview?.status === 'completed' ? aiReview.verdict : undefined;
    const isPingedByAiReview = !!completedVerdict
      && (completedVerdict.needsHumanReview
        || FORCE_PING_REVIEW_ACTIONS.includes(completedVerdict.action));

    let aiReviewText = 'N/A';
    if (aiReview?.status === 'failed') {
      aiReviewText = '⚠️ AI review failed (published with defaults)';
    } else if (completedVerdict) {
      aiReviewText = [
        isPingedByAiReview ? '👀 Human review requested' : '',
        `${completedVerdict.action} | hkRisk: ${completedVerdict.hkRisk} | adult: ${completedVerdict.adult}`
          + ` | copyright: ${completedVerdict.copyrightFlag} | confidence: ${completedVerdict.confidence}`,
        escapeSlackText(completedVerdict.reason),
      ].filter(Boolean).join('\n');
    }

    // Held/pinged listings repurpose the approvalStatus line as the review
    // request: that workflow variable already renders, while the aiReview key
    // stays invisible until it is declared in the Slack workflow.
    let approvalStatusText = isAutoApproved
      ? '✅ Auto-approved (Trusted Publisher)'
      : '⏳ Pending Approval';
    if (completedVerdict?.action === 'stop_sale_review') {
      approvalStatusText = '🚫 Held for review by AI screen — release with'
        + ` \`/book approve ${classId} <approve_with_ads|approve_no_ads|approve_hidden|reject>\``;
    } else if (completedVerdict && isPingedByAiReview) {
      approvalStatusText = `👀 Published, but the AI screen requests human review: ${escapeSlackText(completedVerdict.reason)}`;
    }

    const filesText = (fileRecords || []).map((f) => {
      const label = [f.name, f.contentType, f.isEncrypted ? 'encrypted' : ''].filter(Boolean).join(', ');
      return label ? `${label}\n${f.url}` : f.url;
    }).join('\n\n') || 'N/A';

    const fingerprintsText = (contentFingerprints || []).join('\n') || 'N/A';

    const payload: any = {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      wallet,
      className,
      classLink,
      editions,
      classId,
      approvalStatus: approvalStatusText,
      ...(isAdultOnly ? { adultOnly: '🔞 Adult Content (18+)' } : {}),
      files: filesText,
      fingerprints: fingerprintsText,
      aiReview: aiReviewText,
    };

    await axios.post(NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookApprovalUpdateSlackNotification({
  classId,
  className,
  action,
  restrictedTerritories,
}: {
  classId: string;
  className: string;
  action: string;
  restrictedTerritories?: string[];
}) {
  if (!NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = getBook3NFTClassPageURL({ classId });

    let actionText = '';
    switch (action) {
      case 'approve_with_ads':
        actionText = '✅ Approved for Listing & Ads';
        break;
      case 'approve_no_ads':
        actionText = '✓ Approved for Listing (No Ads)';
        break;
      case 'reject':
        actionText = '❌ Rejected/Hidden';
        break;
      case 'geoblock':
        actionText = `🌍 Territory restricted (${(restrictedTerritories || []).join(', ')})`;
        break;
      case 'clear_geoblock':
        actionText = '🌍 Territory restriction cleared';
        break;
      default:
        actionText = action;
    }

    await axios.post(NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      classId,
      className,
      classLink,
      approvalStatus: actionText,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookSalesSlackNotification({
  classId = '',
  bookName,
  paymentId,
  email,
  priceName,
  priceWithCurrency,
  method,
  from = '',
} : {
  classId?: string;
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
    const classLink = getBook3NFTClassPageURL({ classId });
    const paymentLink = getNFTBookStoreSendPageURL(classId, paymentId);
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
  userId: string;
  stripeCustomerId?: string;
  method?: LikerPlusProvider;
  isTrial?: boolean;
}) {
  if (!PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK) return;
  try {
    let subscriptionType = '';
    if (isTrial) {
      subscriptionType = 'New trial';
    } else if (isNew) {
      subscriptionType = 'New';
    } else {
      subscriptionType = 'Renewed';
    }
    const customerId = stripeCustomerId || 'N/A';
    const stripeEndpoint = `https://dashboard.stripe.com${IS_TESTNET ? '/test' : ''}`;
    // The Slack message renders these as link buttons, which reject an empty URL,
    // so every branch must resolve to a real page.
    const profileLink = `https://${BOOK3_HOSTNAME}/store/@${userId}`;
    const customerLink = stripeCustomerId ? `${stripeEndpoint}/customers/${stripeCustomerId}` : profileLink;
    let subscriptionLink = profileLink;
    if (method === 'stripe') {
      subscriptionLink = `${stripeEndpoint}/subscriptions/${subscriptionId}`;
    } else if (method === 'revenuecat') {
      subscriptionLink = REVENUECAT_DASHBOARD_URL;
    }

    let methodDisplayName = method as string;
    if (method === 'stripe') {
      methodDisplayName = 'Stripe';
    } else if (method === 'revenuecat') {
      methodDisplayName = 'RevenueCat';
    } else if (method === 'shared') {
      methodDisplayName = 'shared by Civic';
    }

    await axios.post(PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      subscriptionType,
      subscriptionId,
      subscriptionLink,
      email,
      userId,
      customerId,
      customerLink,
      priceWithCurrency,
      method: methodDisplayName,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookInvalidChannelIdSlackNotification({
  classId = '',
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
    const classLink = getBook3NFTClassPageURL({ classId });
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

// A broken destination account fails on every sale until someone fixes it, and Slack
// rate-limits a hook to roughly one message per second. Report each account once per window;
// console.error still records every occurrence.
const TRANSFER_FAILED_NOTIFICATION_WINDOW = 10 * 60 * 1000;
const transferFailedNotifiedAt = new Map<string, number>();

function shouldReportTransferFailure(key: string) {
  const now = Date.now();
  transferFailedNotifiedAt.forEach((at, k) => {
    if (now - at > TRANSFER_FAILED_NOTIFICATION_WINDOW) transferFailedNotifiedAt.delete(k);
  });
  if (transferFailedNotifiedAt.has(key)) return false;
  transferFailedNotifiedAt.set(key, now);
  return true;
}

export async function sendStripeTransferFailedSlackNotification({
  type,
  wallet,
  stripeConnectAccountId,
  amount,
  currency,
  classId = '',
  bookName,
  paymentId,
  error,
}: {
  type: CommissionType;
  wallet: string;
  stripeConnectAccountId: string;
  amount: number;
  currency: string;
  classId?: string;
  bookName: string;
  paymentId?: string;
  error: string;
}) {
  if (!NFT_BOOK_SALES_TRANSFER_FAILED_NOTIFICATION_WEBHOOK) return;
  if (!shouldReportTransferFailure(`${type}:${stripeConnectAccountId}`)) return;
  try {
    const classLink = getBook3NFTClassPageURL({ classId });
    await axios.post(NFT_BOOK_SALES_TRANSFER_FAILED_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',

      type,
      wallet,
      stripeConnectAccountId,
      amount: `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`,
      error,

      className: bookName,
      classLink,
      paymentId,
    }, { timeout: 5000 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function sendNFTBookOutOfStockSlackNotification({
  priceIndex,
  email,
  classId = '',
  wallet,
  className,
  stock,
  priceName,
}: {
  wallet: string;
  classId?: string;
  className: string;
  priceIndex: number;
  email: string;
  stock: number;
  priceName: string;
}) {
  if (!NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK) return;
  try {
    const classLink = getBook3NFTClassPageURL({ classId });
    await axios.post(NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK, {
      network: IS_TESTNET ? 'testnet' : 'mainnet',
      priceIndex,
      classLink,
      wallet,
      className,
      stock,
      priceName,
      email,
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

function formatValueRecursively(key, value, depth = 0): string {
  const indent = '  '.repeat(depth);
  if (key === 'evmWallet') return `<https://${BOOK3_HOSTNAME}/shelf/${value}|${value}>`;
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

  const classLink = getBook3NFTClassPageURL({ classId });
  const text = `*Payment ID*\n<https://dashboard.stripe.com/test/search?query=${paymentId}|${paymentId}>\n\n*Class ID*\n<${classLink}|${classId}>\n\n*Session ID*\n\`${sessionId}\`\n\n*Claim Token*\n\`${claimToken}\``;

  const fields = [
    {
      type: 'mrkdwn',
      text: `*Timestamp*\n${timestamp.toDate().toLocaleString()}`,
    },
    {
      type: 'mrkdwn',
      text: `*Email*\n<https://dashboard.stripe.com/search?query=${email}|${email}>`,
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
      text: `*Wallet*\n\`${wallet}\``,
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
  cartId = '',
  paymentId = '',
  status = '',
}) {
  const isEmail = emailOrWallet && emailOrWallet.includes('@') && emailOrWallet.includes('.');
  const emailOrWalletDisplay = isEmail
    ? `<https://dashboard.stripe.com/search?query=${emailOrWallet}|${emailOrWallet}>`
    : emailOrWallet;

  const contextArray = [
    emailOrWallet && `for ${emailOrWalletDisplay}`,
    classId && `in class ${classId}`,
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
