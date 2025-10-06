import type { UserCivicLikerProperties } from './user';

// User-related filter interfaces
export interface UserDataFiltered extends Omit<UserCivicLikerProperties, 'referrer' | 'authCoreUserId' | 'read'> {
  referrer: boolean;
  isAuthCore: boolean;
  read: Record<string, any>;
}

export interface UserDataMin extends Pick<UserCivicLikerProperties,
  'user' | 'displayName' | 'avatar' | 'cosmosWallet' |
  'likeWallet' | 'evmWallet' | 'isSubscribedCivicLiker' |
  'isCivicLikerTrial' | 'civicLikerSince' | 'likerPlusSince' |
  'isLikerPlus' | 'description'> {
  wallet?: string;
  paymentRedirectWhiteList?: string[];
  creatorPitch?: string;
}

export interface UserDataScopedFiltered extends UserDataMin {
  likerPlusPeriod?: any;
  email?: string;
  isExpiredCivicLiker?: boolean;
  isCivicLikerRenewalPeriod?: boolean;
  civicLikerRenewalPeriodLast?: number;
  isHonorCivicLiker?: boolean;
  civicLikerVersion?: number;
  locale?: string;
}

// Transaction and NFT interfaces
export interface TxData {
  from: string;
  fromId?: string;
  to: string;
  toId?: string;
  value: string | number;
  amount?: string | number;
  status: string;
  type: string;
  remarks?: string;
  httpReferrer?: string;
  completeTs?: number;
  ts: number;
  txHash?: string;
}

export interface LikeNFTISCNData {
  iscnId: string;
  classId: string;
  nextNewNFTId?: number;
  totalCount?: number;
  currentPrice?: number;
  basePrice?: number;
  soldCount?: number;
  classUri?: string;
  creatorWallet?: string;
  ownerWallet?: string;
}

export interface LikeNFTMetadata {
  image?: string;
  externalUrl?: string;
  description?: string;
  name?: string;
  backgroundColor?: string;
  animationUrl?: string;
  youtubeUrl?: string;
  iscnOwner?: string;
  iscnStakeholders?: any;
  iscnId?: string;
  iscnRecordTimestamp?: number;
  [key: string]: any;
}

export interface LikeNFTMetadataFiltered {
  image?: string;
  /* eslint-disable camelcase */
  external_url?: string;
  description?: string;
  name?: string;
  background_color?: string;
  animation_url?: string;
  youtube_url?: string;
  iscn_id?: string;
  iscn_owner?: string;
  iscn_record_timestamp?: number;
  iscn_stakeholders?: any;
  /* eslint-enable camelcase */
  [key: string]: any;
}

// Book purchase and commission interfaces
export interface BookPurchaseData {
  id?: string;
  email?: string;
  status?: string;
  sessionId?: string;
  isPendingClaim?: boolean;
  isPaid?: boolean;
  errorMessage?: string;
  wallet?: string;
  classId?: string;
  priceInDecimal?: number;
  price?: number;
  originalPrice?: number;
  originalPriceInDecimal?: number;
  priceIndex?: number;
  priceName?: string;
  coupon?: string;
  txHash?: string;
  message?: string;
  from?: string;
  giftInfo?: any;
  timestamp?: { toMillis: () => number };
  autoMemo?: string;
  isAutoDeliver?: boolean;
  quantity?: number;
  classIds?: string[];
  classIdsWithPrice?: any[];
}

export interface BookPurchaseDataFiltered extends Omit<BookPurchaseData, 'timestamp' | 'quantity'> {
  timestamp?: number;
  quantity: number;
}

export interface BookPurchaseCartData extends BookPurchaseData {
  claimToken?: string;
  claimedClassIds?: string[];
  errors?: any[];
  loginMethod?: string;
}

export interface BookPurchaseCommission {
  type: string;
  ownerWallet: string;
  classId?: string;
  priceIndex?: number;
  collectionId?: string;
  transferId?: string;
  stripeConnectAccountId?: string;
  paymentId: string;
  amountTotal: number;
  amount: number;
  currency: string;
  timestamp?: { toMillis: () => number };
}

export interface BookPurchaseCommissionFiltered extends Omit<BookPurchaseCommission, 'timestamp'> {
  timestamp?: number;
}

// OAuth, app meta, notification, and other interfaces
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

export interface AppMeta {
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  referrer?: string;
  ts?: number;
  android?: any;
  ios?: any;
}

export interface AppMetaFiltered extends Omit<AppMeta, 'referrer'> {
  isNew: boolean;
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

export interface NFTBookPrice {
  name?: string | Record<string, string>;
  description?: string | Record<string, string>;
  priceInDecimal: number;
  isAllowCustomPrice?: boolean;
  isTippingEnabled?: boolean;
  isUnlisted?: boolean;
  sold?: number;
  stock?: number;
  isAutoDeliver?: boolean;
  autoMemo?: string;
  index?: number;
  order?: number;
  stripeProductId?: string;
  stripePriceId?: string;
}

export interface NFTBookPriceFiltered {
  index: number;
  price: number;
  name?: string | Record<string, string>;
  description?: string | Record<string, string>;
  stock: number;
  isSoldOut: boolean;
  isAutoDeliver?: boolean;
  isUnlisted?: boolean;
  autoMemo?: string;
  isAllowCustomPrice?: boolean;
  isTippingEnabled?: boolean;
  order: number;
  sold?: number;
}

export interface NFTBookPricesInfoFiltered {
  sold: number;
  stock: number;
  prices: NFTBookPriceFiltered[];
}

export interface NFTBookListingInfo {
  id?: string;
  classId: string;
  likeClassId?: string;
  evmClassId?: string;
  redirectClassId?: string;
  chain?: string;
  prices?: NFTBookPrice[];
  pendingNFTCount?: number;
  ownerWallet: string;
  moderatorWallets?: string[];
  connectedWallets?: any;
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  hideAudio?: boolean;
  enableCustomMessagePage?: boolean;
  tableOfContents?: any;
  signedMessageText?: string;
  enableSignatureImage?: boolean;
  recommendedClassIds?: string[];
  inLanguage?: string;
  name?: string;
  description?: string;
  keywords?: string[];
  thumbnailUrl?: string;
  author?: string;
  usageInfo?: string;
  isbn?: string;
  timestamp?: { toMillis: () => number };
  isHidden?: boolean;
  isLikerLandArt?: boolean;
}

export interface NFTBookListingInfoFiltered {
  id: string;
  classId: string;
  likeClassId?: string;
  evmClassId?: string;
  redirectClassId?: string;
  chain?: string;
  prices: NFTBookPriceFiltered[];
  isSoldOut: boolean;
  stock: number;
  ownerWallet: string;
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  hideAudio?: boolean;
  enableCustomMessagePage?: boolean;
  tableOfContents?: any;
  signedMessageText?: string;
  enableSignatureImage?: boolean;
  recommendedClassIds?: string[];
  inLanguage?: string;
  name?: string;
  description?: string;
  keywords?: string[];
  thumbnailUrl?: string;
  author?: string;
  usageInfo?: string;
  isbn?: string;
  timestamp?: number;
  isHidden?: boolean;
  sold?: number;
  pendingNFTCount?: number;
  moderatorWallets?: string[];
  connectedWallets?: any;
}
