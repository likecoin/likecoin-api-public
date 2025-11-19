// NFT Book purchase and listing related types

export interface BookGiftInfo {
  fromName?: string;
  toName?: string;
  toEmail: string;
  message?: string;
  [key: string]: unknown;
}

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
  isGift?: boolean;
  giftInfo?: BookGiftInfo;
  timestamp?: { toMillis: () => number };
  autoMemo?: string;
  isAutoDeliver?: boolean;
  quantity?: number;
  classIds?: string[];
  classIdsWithPrice?: any[];
  claimToken?: string;
  lastRemindTimestamp?: { toMillis: () => number };
}

export interface BookPurchaseDataFiltered extends Omit<BookPurchaseData, 'claimToken' | 'timestamp' | 'lastRemindTimestamp' | 'quantity'> {
  timestamp?: number;
  quantity: number;
}

export interface BookPurchaseCartData extends BookPurchaseData {
  claimToken?: string;
  claimedClassIds?: string[];
  errors?: any[];
  loginMethod?: string;
}

export interface PlusGiftCartData {
  id?: string;
  email?: string;
  status?: string;
  sessionId?: string;
  errorMessage?: string;
  wallet?: string;
  period: string;
  giftInfo: BookGiftInfo;
  claimToken: string;
  timestamp: { toMillis: () => number };
  claimTimestamp?: { toMillis: () => number };
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
  descriptionFull?: string;
  descriptionSummary?: string;
  keywords?: string[];
  thumbnailUrl?: string;
  author?: string;
  usageInfo?: string;
  isbn?: string;
  timestamp?: { toMillis: () => number };
  isHidden?: boolean;
  isLikerLandArt?: boolean;
  isApprovedForSale?: boolean;
  isApprovedForIndexing?: boolean;
  isApprovedForAds?: boolean;
  approvalStatus?: string;
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
  descriptionFull?: string;
  descriptionSummary?: string;
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
  isApprovedForSale: boolean;
  isApprovedForIndexing: boolean;
  isApprovedForAds: boolean;
  approvalStatus?: string;
}

export interface NFTBookUserData {
  userId?: string;
  classId?: string;
  purchaseTs?: number;
  evmWallet?: string;
  likeWallet?: string;
  stripeConnectAccountId?: string;
  isStripeConnectReady?: boolean;
  stripeCustomerId?: string;
  migrateMethod?: string;
  migrateTimestamp?: any;
  timestamp?: any;
  [key: string]: any;
}

export interface FreeBookClaimResult {
  classIds: string[];
  cartId: string;
  paymentId: string;
  claimToken: string;
}
