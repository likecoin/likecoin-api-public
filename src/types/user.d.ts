import type { Timestamp } from '@google-cloud/firestore';
import type { StoredLocale } from '../locales';
import type { LikerPlusTier } from '../constant';
import type { LIKER_PLUS_SUBSCRIPTION_STATUSES } from '../util/api/users/schemas';

export interface CivicLikerData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  since: number;
  currentType?: string;
  civicLikerVersion?: number;
}

export type LikerPlusSubscriptionStatus = typeof LIKER_PLUS_SUBSCRIPTION_STATUSES[number];

export type LikerPlusProvider = 'stripe' | 'revenuecat';

export interface LikerPlusData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  currentType?: string;
  since: number;
  period?: string;
  // Subscription tier. Absent on records written before Civic existed — read
  // it as 'plus'. Civic keeps every Plus flag true (superset semantics).
  tier?: LikerPlusTier;
  // Per-day value of the current term (in `dailyValueCurrency`), used to fund the
  // reading-library revenue-share pool. 0 for trials. See calculatePlusDailyValue.
  dailyValue?: number;
  dailyValueCurrency?: string;
  subscriptionId?: string;
  customerId?: string;
  subscriptionStatus?: LikerPlusSubscriptionStatus;
  // Platform that last wrote this record. Stripe (web) and RevenueCat (mobile)
  // share one record on a latest-write-wins basis.
  provider?: LikerPlusProvider;
  // RevenueCat-only: originating store (e.g. 'APP_STORE', 'PLAY_STORE') and the
  // store's original transaction id, used for debugging and idempotency.
  store?: string;
  originalTransactionId?: string;
  // RevenueCat-only: 'SANDBOX' when the record was last written by a sandbox
  // event (App Store / Play Store reviewer traffic). Undefined for production
  // records (legacy Stripe records also have no env tag). Used by dashboards
  // to filter sandbox traffic out of revenue metrics, and by the RC handlers
  // to prevent sandbox events from mutating production records.
  environment?: 'SANDBOX' | 'PRODUCTION';
  // Free gift book attached to a yearly subscription. On the Stripe (web) path
  // these live in the Stripe subscription metadata; on the RevenueCat (mobile)
  // path there is no Stripe subscription, so the grant handler persists them
  // here. GET /plus/gift reads from whichever source owns the record.
  giftClassId?: string;
  giftCartId?: string;
  giftPaymentId?: string;
  giftClaimToken?: string;
  affiliateFrom?: string;
}

/**
 * Immutable per-term funding record for the reading-library revenue-share pool,
 * written at invoice time under `users/{likerId}/plusReadingAccrual/{termKey}`.
 * One doc per paid subscription term; settlement sums each term's day-overlap with
 * the settlement month. `dailyValueUSD` is pre-normalized so the pool is single-currency.
 */
export interface PlusReadingAccrualData {
  dailyValueUSD: number;
  // Original charge currency, kept for audit only — the pool itself is USD.
  currency: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  paidDays: number;
  provider: LikerPlusProvider;
  subscriptionId: string;
}

export interface UserData {
  // Identity fields
  isDeleted?: boolean;
  displayName?: string;
  description?: string;
  creatorPitch?: string;

  // Avatar fields
  avatar?: string;
  avatarHash?: string;

  // Email fields
  email?: string;
  isEmailVerified?: boolean;
  isEmailEnabled?: boolean;
  normalizedEmail?: string;
  isEmailInvalid?: boolean;
  isEmailBlacklisted?: boolean;
  isEmailDuplicated?: boolean;
  lastVerifyTs?: number;
  verificationUUID?: string;

  // Phone fields
  phone?: string;
  isPhoneVerified?: boolean;

  // Wallet fields
  likeWallet?: string;
  cosmosWallet?: string;
  evmWallet?: string;
  wallet?: string;

  // Set by the EVM migration; migrateTimestamp only on the legacy v1 path.
  migrateMethod?: 'manual' | 'auto';
  migrateTimestamp?: Timestamp;

  // Auth provider fields
  authCoreUserId?: string;
  magicUserId?: string;

  // Platform fields
  delegatedPlatform?: string;
  isPlatformDelegated?: boolean;
  mediaChannels?: string[];

  // Subscription fields
  civicLiker?: CivicLikerData;
  likerPlus?: LikerPlusData;

  // Purchase history
  firstPaidAt?: Timestamp;
  lastPaidAt?: Timestamp;

  // Metadata fields
  // Stored locale may include legacy codes (e.g. 'cn') beyond supportedLocales.
  locale?: StoredLocale;
  timestamp?: number;
  bonusCooldown?: number;
  referrer?: string;
  isLocked?: boolean;
  pendingLIKE?: Record<string, number>;
  isPendingLIKE?: boolean;

  paymentRedirectWhiteList?: string[];
}

export interface UserCivicLikerProperties extends UserData {
  user: string;
  isCivicLikerRenewalPeriod?: boolean;
  civicLikerSince?: number;
  civicLikerRenewalPeriodLast?: number;
  isHonorCivicLiker?: boolean;
  civicLikerVersion?: number;
  isCivicLikerTrial?: boolean;
  isSubscribedCivicLiker?: boolean;
  isExpiredCivicLiker?: boolean;
  likerPlusSince?: number;
  isLikerPlus?: boolean;
  isLikerPlusTrial?: boolean;
  isExpiredLikerPlus?: boolean;
  likerPlusPeriod?: string;
  likerPlusTier?: LikerPlusTier;
  likerPlusProvider?: LikerPlusProvider;
  likerPlusSubscriptionStatus?: LikerPlusSubscriptionStatus;
  plusAffiliateFrom?: string;
}
