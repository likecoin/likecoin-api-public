export interface CivicLikerData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  since: number;
  currentType?: string;
  civicLikerVersion?: number;
}

export interface LikerPlusData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  since: number;
  period?: string;
  subscriptionId?: string;
  customerId?: string;
}

export interface UserData {
  // Identity fields
  isDeleted?: boolean;
  displayName?: string;
  description?: string;

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

  // Metadata fields
  locale?: string;
  timestamp?: number;
  bonusCooldown?: number;
  referrer?: string;
  isLocked?: boolean;
  pendingLIKE?: Record<string, number>;
  isPendingLIKE?: boolean;

  // Allow additional fields
  [key: string]: any;
}

export interface UserCivicLikerProperties extends UserData {
  user: string;
  avatar: string;
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
  likerPlusPeriod?: string;
}
