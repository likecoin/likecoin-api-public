import Stripe from 'stripe';
import { ValidationError } from '../../../ValidationError';
import { likeNFTBookUserCollection } from '../../../firebase';
import {
  getUserWithCivicLikerProperties,
  getUserWithCivicLikerPropertiesByWallet,
} from '../../users/getPublicInfo';
import type { NFTBookUserData } from '../../../../types/book';
import type { BookUserInfoResult } from '../../../../types/firestore';

export async function getBookUserInfo(wallet: string): Promise<NFTBookUserData | null> {
  const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
  const userData = userDoc.data();
  if (!userData) {
    return null;
  }
  return userData;
}

export async function checkIsTrustedPublisher(wallet: string): Promise<boolean> {
  const userInfo = await getBookUserInfo(wallet);
  return userInfo?.isTrustedPublisher || false;
}

export async function getBookUserInfoFromWallet(wallet: string): Promise<BookUserInfoResult> {
  const [bookUserInfo, likerUserInfo] = await Promise.all([
    getBookUserInfo(wallet),
    getUserWithCivicLikerPropertiesByWallet(wallet),
  ]);
  return { wallet, bookUserInfo, likerUserInfo };
}

export async function getBookUserInfoFromLikerId(
  likerId: string,
): Promise<BookUserInfoResult | null> {
  const userInfo = await getUserWithCivicLikerProperties(likerId);
  if (!userInfo) return null;
  const { likeWallet, evmWallet } = userInfo;
  const wallet = evmWallet || likeWallet;
  if (!wallet) return null;
  const user = await getBookUserInfo(wallet);
  return {
    wallet, bookUserInfo: user, likerUserInfo: userInfo,
  };
}

export async function getBookUserInfoFromLegacyString(
  from: string,
): Promise<BookUserInfoResult | null> {
  const userQuery = await likeNFTBookUserCollection
    .where('fromString', '==', from)
    .limit(2)
    .get();
  const userDoc = userQuery.docs[0];
  if (!userDoc) {
    return null;
  }
  const userData = userDoc.data();
  if (!userData) {
    return null;
  }
  const wallet = userDoc.id;
  const likerUserInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
  return { wallet: userDoc.id, bookUserInfo: userData, likerUserInfo };
}

export async function validateConnectedWallets(connectedWallets: {[key: string]: number}) {
  if (Object.values(connectedWallets).reduce((a, b) => a + b, 0) > 100) {
    throw new ValidationError('INVALID_CONNECTED_WALLETS_VALUES');
  }
  const connectedWalletsKeys = Object.keys(connectedWallets);
  const userDocs = await Promise.all(connectedWalletsKeys
    .map((wallet) => likeNFTBookUserCollection.doc(wallet).get()));
  const userData = userDocs.map((u: any) => ({ id: u.id, ...(u.data() || {}) }));
  const invalidData = userData.find((u: any) => !u.isStripeConnectReady);
  if (invalidData) throw new ValidationError(`INVALID_CONNECTED_WALLETS: ${invalidData}`);
  return true;
}

export async function handleNFTBookStripeSessionCustomer(
  session: Stripe.Checkout.Session,
) {
  const { customer, metadata } = session;
  if (!customer || !metadata) return;
  const { likeWallet, evmWallet } = metadata;
  const wallet = evmWallet || likeWallet;
  if (!wallet) return;
  const res = await getBookUserInfoFromWallet(wallet);
  const { bookUserInfo } = res;
  if (bookUserInfo?.stripeCustomerId) return;
  await likeNFTBookUserCollection.doc(wallet).set({
    stripeCustomerId: typeof customer === 'string' ? customer : customer.id,
  }, { merge: true });
}

const SUBSCRIPTION_AFFILIATE_PAYOUTS_COLLECTION = 'subscriptionAffiliatePayouts';
const SUBSCRIPTION_AFFILIATE_REPORT_LIMIT = 250;

export interface SubscriptionAffiliateReportEntry {
  subscriptionId: string;
  transferId: string;
  interval: 'month' | 'year';
  commissionRate: number;
  balanceTxCents: number;
  feeCents: number;
  payoutCents: number;
  currency: string;
  invoiceId?: string;
  subscribedAt?: number;
  payoutAt: number;
}

export interface SubscriptionAffiliateReport {
  payouts: SubscriptionAffiliateReportEntry[];
  summary: {
    totalCents: number;
    subscriptionCount: number;
  };
}

/**
 * A publisher's affiliate commissions, newest payout first. `payoutAt` is the sort key
 * because it is the only timestamp every doc carries — ordering on an optional field
 * would make the docs missing it invisible to the query.
 */
export async function getSubscriptionAffiliateReportForWallet(
  wallet: string,
): Promise<SubscriptionAffiliateReport> {
  const snap = await likeNFTBookUserCollection
    .doc(wallet)
    .collection(SUBSCRIPTION_AFFILIATE_PAYOUTS_COLLECTION)
    .orderBy('payoutAt', 'desc')
    .limit(SUBSCRIPTION_AFFILIATE_REPORT_LIMIT)
    .get();

  const payouts: SubscriptionAffiliateReportEntry[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      subscriptionId: String(data.subscriptionId || doc.id),
      transferId: String(data.transferId || ''),
      // Coerced, not validated: sendValidatedJSON throws on a mismatch,
      // so one odd doc would blank the whole response.
      interval: data.interval === 'year' ? 'year' : 'month',
      commissionRate: Number(data.commissionRate) || 0,
      balanceTxCents: Number(data.balanceTxCents) || 0,
      feeCents: Number(data.feeCents) || 0,
      payoutCents: Number(data.payoutCents) || 0,
      currency: data.currency || 'usd',
      // Omitted, never null: the schema's .optional() rejects null.
      invoiceId: data.invoiceId || undefined,
      subscribedAt: data.subscribedAt?.toMillis?.() ?? undefined,
      payoutAt: data.payoutAt?.toMillis?.() ?? 0,
    };
  });

  return {
    payouts,
    summary: {
      totalCents: payouts.reduce((sum, p) => sum + p.payoutCents, 0),
      subscriptionCount: payouts.length,
    },
  };
}
