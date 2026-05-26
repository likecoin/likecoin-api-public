import type { Timestamp } from '@google-cloud/firestore';
import type { SupportedLocale } from '../locales';
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
  locale?: SupportedLocale;
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
  likerPlusProvider?: LikerPlusProvider;
  likerPlusSubscriptionStatus?: LikerPlusSubscriptionStatus;
  plusAffiliateFrom?: string;
}
