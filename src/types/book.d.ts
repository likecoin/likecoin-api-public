// NFT Book purchase and listing related types

import type { z } from 'zod';
import type {
  BookContributorSchema,
  BookSignatureImageSchema,
  BookFreeClaimResponseSchema,
  BookGiftInfoSchema,
  BookPurchaseCommissionFilteredSchema,
  BookPurchaseDataFilteredSchema,
  NFTBookListingInfoFilteredSchema,
  NFTBookPriceFilteredSchema,
  NFTBookPricesInfoFilteredSchema,
  PriceInDecimalByCurrencySchema,
} from '../util/api/likernft/book/schemas';
import type {
  AffiliateConfigSchema,
  PlusGiftCartStatusResponseSchema,
} from '../util/api/plus/schemas';

export type BookGiftInfo = z.infer<typeof BookGiftInfoSchema>;

export type BookContributor = z.infer<typeof BookContributorSchema>;

export type BookSignatureImage = z.infer<typeof BookSignatureImageSchema>;

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

export type BookPurchaseDataFiltered = z.infer<typeof BookPurchaseDataFilteredSchema>;

export interface BookPurchaseCartData extends BookPurchaseData {
  claimToken?: string;
  claimedClassIds?: string[];
  errors?: any[];
  loginMethod?: string;
}

export interface PlusGiftCartData {
  id?: string;
  email?: string;
  status?: 'paid' | 'pending' | 'completed' | 'error';
  sessionId?: string;
  errorMessage?: string;
  wallet?: string;
  period: 'monthly' | 'yearly';
  giftInfo: BookGiftInfo;
  claimToken: string;
  ipCountry?: string;
  timestamp: { toMillis: () => number };
  claimTimestamp?: { toMillis: () => number };
}

export type PlusGiftCartDataFiltered = z.infer<typeof PlusGiftCartStatusResponseSchema>;

export interface BookPurchaseCommission {
  type: string;
  ownerWallet?: string;
  classId?: string;
  priceIndex?: number;
  collectionId?: string;
  transferId?: string;
  stripeConnectAccountId?: string;
  paymentId: string;
  amountTotal: number;
  amount: number;
  currency: string;
  description?: string;
  buyerEmail?: string;
  timestamp?: { toMillis: () => number };
}

export type BookPurchaseCommissionFiltered = z.infer<typeof BookPurchaseCommissionFilteredSchema>;

// Per-currency price overrides, in that currency's minor units (e.g. cents),
// matching the convention of `priceInDecimal`. A missing currency falls back
// to the index-based ladder conversion.
export type BookPriceInDecimalByCurrency = z.infer<typeof PriceInDecimalByCurrencySchema>;

export interface NFTBookPrice {
  name?: string | Record<string, string>;
  description?: string | Record<string, string>;
  priceInDecimal: number;
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency;
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

export type NFTBookPriceFiltered = z.infer<typeof NFTBookPriceFilteredSchema>;

export type NFTBookPricesInfoFiltered = z.infer<typeof NFTBookPricesInfoFilteredSchema>;

export interface NFTBookListingInfo {
  id?: string;
  classId: string;
  likeClassId?: string;
  evmClassId?: string;
  redirectClassId?: string;
  chain?: string;
  cmsTags?: Record<string, number>;
  prices?: NFTBookPrice[];
  minPriceInDecimal?: number;
  pendingNFTCount?: number;
  ownerWallet: string;
  moderatorWallets?: string[];
  connectedWallets?: any;
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  hideAudio?: boolean;
  hideUpsell?: boolean;
  enableCustomMessagePage?: boolean;
  tableOfContents?: any;
  signedMessageText?: string;
  enableSignatureImage?: BookSignatureImage;
  recommendedClassIds?: string[];
  inLanguage?: string;
  name?: string;
  description?: string;
  descriptionFull?: string;
  previewContent?: string;
  descriptionSummary?: string;
  promotionalImages?: string[];
  promotionalVideos?: string[];
  reviewTitle?: string;
  reviewURL?: string;
  keywords?: string[];
  thumbnailUrl?: string;
  author?: BookContributor;
  usageInfo?: string;
  isbn?: string;
  image?: string;
  publisher?: BookContributor;
  genre?: string;
  timestamp?: { toMillis: () => number };
  isHidden?: boolean;
  // Unlike `isHidden`, which only unlists, this 404s the listing to the public
  // while it awaits review. Owners and moderators still see it.
  isPendingReview?: boolean;
  isAdultOnly?: boolean;
  isLikerLandArt?: boolean;
  isApprovedForSale?: boolean;
  isApprovedForIndexing?: boolean;
  isApprovedForAds?: boolean;
  approvalStatus?: string;
  plusPromoEnabled?: boolean;
  isPlusReadingEnabled?: boolean;
  isPreviewEnabled?: boolean;
  previewPercentage?: number;
  // Lifetime recorded reading + TTS time, denormalized from the `plusUsage`
  // rollups so listings can order by it. See recordPlusReadingUsage.
  plusReadingTotalMs?: number;
  successUrl?: string;
  cancelUrl?: string;
}

export interface NFTBookCMSTag {
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  isPublic: boolean;
  isForLibrary?: boolean;
  isForStore?: boolean;
  order: string;
  timestamp?: any;
  lastUpdateTimestamp?: any;
}

export type NFTBookListingInfoFiltered = z.infer<typeof NFTBookListingInfoFilteredSchema>;

export type AffiliateConfig = z.infer<typeof AffiliateConfigSchema>;
export type AffiliateGiftBook = NonNullable<AffiliateConfig['giftBooks']>[number];
export type AffiliateCustomVoice = AffiliateConfig['customVoices'][number];

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
  sponsoredUploadBytes?: number;
  sponsoredUploadCount?: number;
  sponsoredUploadETH?: string;
  lastSponsoredUploadDate?: string;
  isUnlimitedSponsoredUpload?: boolean;
  affiliateConfig?: AffiliateConfig;
  /** When true, Plus members arriving via this user's `from=@likerId`
   *  channel still receive the 20% Plus discount; the 30% channel share
   *  absorbs the discount cost via the existing commission math in
   *  `calculateItemPrices`. Lives at the user-doc root because channel
   *  commission flows from `from` regardless of `affiliateConfig.active`. */
  isPlusDiscountAllowed?: boolean;
  [key: string]: any;
}

export type FreeBookClaimResult = z.infer<typeof BookFreeClaimResponseSchema>;
