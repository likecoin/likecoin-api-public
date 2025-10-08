// Firestore collection document types
// These represent the raw data structures stored in Firestore collections

export interface UserAuthData {
  platforms: Record<string, any>;
  cosmosWallet?: string;
  user?: string;
  ts?: number;
  [key: string]: any;
}

export interface SubscriptionUserData {
  userId: string;
  email?: string;
  subscriptionId?: string;
  customerId?: string;
  status?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  [key: string]: any;
}

export interface SuperLikeData {
  userId: string;
  superLikeCount?: number;
  cooldown?: number;
  ts?: number;
  [key: string]: any;
}

export interface IAPData {
  userId: string;
  productId?: string;
  platform?: string;
  transactionId?: string;
  receipt?: string;
  status?: string;
  ts?: number;
  [key: string]: any;
}

export interface MissionData {
  id: string;
  title?: string;
  description?: string;
  isActive?: boolean;
  reward?: number;
  ts?: number;
  [key: string]: any;
}

export interface PayoutData {
  userId: string;
  amount?: number;
  status?: string;
  method?: string;
  ts?: number;
  [key: string]: any;
}

export interface CouponData {
  code: string;
  discountRate?: number;
  startTs?: number;
  endTs?: number;
  maxUses?: number;
  usedCount?: number;
  isActive?: boolean;
  [key: string]: any;
}

export interface ConfigData {
  key: string;
  value: any;
  ts?: number;
  [key: string]: any;
}

export interface OAuthClientInfo {
  avatar?: string;
  audience?: string;
  description?: string;
  shortName?: string;
  displayName?: string;
  secret?: string;
  redirectWhiteList?: string[];
  scopeWhiteList?: string[];
  defaultScopes?: string[];
  domain?: string;
  platform?: string;
  isTrusted?: boolean;
}

export interface LikeButtonUrlData {
  url: string;
  likeCount?: number;
  ts?: number;
  [key: string]: any;
}

export interface ISCNInfoData {
  iscnId: string;
  owner?: string;
  metadata?: any;
  ts?: number;
  [key: string]: any;
}

export interface ISCNMappingData {
  iscnId: string;
  likerUrl?: string;
  ts?: number;
  [key: string]: any;
}

export interface AppMeta {
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  referrer?: string;
  ts?: number;
  android?: any;
  ios?: any;
}

export interface NotificationData {
  id: string;
  LIKE?: number;
  from?: string;
  isRead?: boolean;
  sourceURL?: string;
  to?: string;
  ts?: number;
  txHash?: string;
  type?: string;
}

export interface BookmarkData {
  id: string;
  url: string;
  ts: number;
  isArchived?: boolean;
}

export interface FollowData {
  id: string;
  isFollowed: boolean;
  ts: number;
}
