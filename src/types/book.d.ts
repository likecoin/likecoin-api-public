// NFT Book purchase and listing related types

import type { z } from 'zod';
import type {
  BookContributorSchema,
  BookFulfilmentSchema,
  BookLocalizedCopySchema,
  BookProductTypeSchema,
  BookSignatureImageSchema,
  BookFreeClaimResponseSchema,
  BookGiftInfoSchema,
  BookPurchaseCommissionFilteredSchema,
  BookPurchaseDataFilteredSchema,
  BookShippingDetailsSchema,
  NFTBookListingInfoFilteredSchema,
  NFTBookPriceFilteredSchema,
  NFTBookPricesInfoFilteredSchema,
  PriceInDecimalByCurrencySchema,
} from '../util/api/likernft/book/schemas';
import type {
  AffiliateConfigSchema,
  PlusGiftCartStatusResponseSchema,
} from '../util/api/plus/schemas';
import type {
  CONFIDENCE_VALUES,
  HK_RISK_LEVELS,
  NFT_BOOK_COMPLIANCE_REVIEW_ACTIONS,
} from '../util/api/likernft/book/complianceReview';

export type BookGiftInfo = z.infer<typeof BookGiftInfoSchema>;

export type BookContributor = z.infer<typeof BookContributorSchema>;

export type BookSignatureImage = z.infer<typeof BookSignatureImageSchema>;

// Mirrors Stripe's address shape, snake_case `postal_code` included, so the
// collected value is stored as-is and read back without a remap.
export type BookShippingDetails = z.infer<typeof BookShippingDetailsSchema>;

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
  // Goods orders only. `phone` and `shippingDetails` are collected by Stripe
  // Checkout; `trackingNumber` and `shippedAt` are written by the `/ship` endpoint.
  phone?: string;
  shippingDetails?: BookShippingDetails;
  trackingNumber?: string;
  shippedAt?: { toMillis: () => number };
}

export type BookPurchaseDataFiltered = z.infer<typeof BookPurchaseDataFilteredSchema>;

export interface BookPurchaseCartData extends BookPurchaseData {
  claimToken?: string;
  claimedClassIds?: string[];
  errors?: any[];
  loginMethod?: string;
  // Buyer LIKE airdrop. `airdropStatus` doubles as the once-only gate, so its
  // presence alone means the payout was already attempted for this cart.
  // 'done' means the transfer was broadcast, not that it is confirmed on chain.
  airdropStatus?: 'processing' | 'done' | 'failed';
  airdropStartedAt?: { toMillis: () => number };
  airdropLIKE?: number;
  airdropWallet?: string;
  airdropTxHash?: string;
  airdropRawTx?: string;
  airdropNonce?: number;
  airdropError?: string;
}

export interface PlusGiftCartData {
  id?: string;
  email?: string;
  status?: 'paid' | 'pending' | 'completed' | 'error';
  sessionId?: string;
  errorMessage?: string;
  wallet?: string;
  period: 'monthly' | 'yearly';
  quantity?: number;
  giftInfo: BookGiftInfo;
  claimToken: string;
  ipCountry?: string;
  timestamp: { toMillis: () => number };
  claimTimestamp?: { toMillis: () => number };
}

export type PlusGiftCartDataFiltered = z.infer<typeof PlusGiftCartStatusResponseSchema>;

export type CommissionType = 'channelCommission' | 'connectedWallet' | 'artFee';

export interface BookPurchaseCommission {
  type: CommissionType;
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
  stripeFeeAmount?: number;
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
  // Goods only: the member price on the same edition, so one `stock` counter
  // backs both prices. See `getIsEligibleForPlusPrice` for who may pay it.
  plusPriceInDecimal?: number;
  plusPriceInDecimalByCurrency?: BookPriceInDecimalByCurrency;
}

export type NFTBookPriceFiltered = z.infer<typeof NFTBookPriceFilteredSchema>;

export type NFTBookPricesInfoFiltered = z.infer<typeof NFTBookPricesInfoFilteredSchema>;

export type NFTBookComplianceReviewAction =
  (typeof NFT_BOOK_COMPLIANCE_REVIEW_ACTIONS)[number];

export interface NFTBookComplianceReviewVerdict {
  action: NFTBookComplianceReviewAction;
  hkRisk: (typeof HK_RISK_LEVELS)[number];
  adult: boolean;
  copyrightFlag: boolean;
  confidence: (typeof CONFIDENCE_VALUES)[number];
  // "Pass but ping": publish under `action`, but ask admins for a second look
  // (privacy, spam, borderline adult, other legal concerns).
  needsHumanReview: boolean;
  reason: string;
}

// Stored on the listing doc as `aiReview`. Admin-only: intentionally absent
// from filterNFTBookListingInfo and NFTBookListingInfoFilteredSchema, so it
// must never be added to either — owners must not see it.
export interface NFTBookComplianceReviewRecord extends NFTBookComplianceReviewVerdict {
  model: string;
  // ms epoch; a FieldValue sentinel cannot be nested inside a map field.
  timestamp: number;
}

export type BookProductType = z.infer<typeof BookProductTypeSchema>;

export type BookLocalizedCopy = z.infer<typeof BookLocalizedCopySchema>;

export type BookFulfilment = z.infer<typeof BookFulfilmentSchema>;

export interface NFTBookListingInfo {
  id?: string;
  classId: string;
  // Absent means 'book': every listing predating non-book goods is a book, and
  // Firestore cannot query for a missing field, so the default must be implicit.
  // Read it through `getBookProductType` / `isGoodsProduct`, never directly.
  productType?: BookProductType;
  fulfilment?: BookFulfilment;
  // ISO 3166-1 alpha-2 ALLOW-list, the inverse of `restrictedTerritories`.
  // Enforced at checkout via Stripe `shipping_address_collection`.
  availableTerritories?: string[];
  // Per-locale copy; the plain `name` / `description` / `descriptionFull`
  // stay the fallback, since every consumer reads them as strings.
  nameByLocale?: BookLocalizedCopy;
  descriptionByLocale?: BookLocalizedCopy;
  descriptionFullByLocale?: BookLocalizedCopy;
  // Per-order cap, summed across a cart; `stock` still bounds the shelf.
  maxQuantityPerOrder?: number;
  likeClassId?: string;
  evmClassId?: string;
  redirectClassId?: string;
  chain?: string;
  cmsTags?: Record<string, number>;
  prices?: NFTBookPrice[];
  minPriceInDecimal?: number;
  pendingNFTCount?: number;
  // Goods sibling of `pendingNFTCount`: paid orders awaiting despatch. Counted
  // at payment rather than at claim, since a goods order is never claimed.
  pendingShipmentCount?: number;
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
  // ISO 3166-1 alpha-2 country codes the storefront must not offer this listing in.
  // Admin-set, not author-editable; enforcement happens client-side.
  restrictedTerritories?: string[];
  aiReview?: NFTBookComplianceReviewRecord;
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
  // Time-weighted reading score for popular order. See getReadingScoreIncrement.
  plusReadingScore?: number;
  // Time-weighted paid-sales score for bestselling order. See getSaleScoreIncrement.
  salesScore?: number;
  lastSaleTimestamp?: any;
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
  conditions?: {
    publishers: string[];
    authors: string[];
    genres: string[];
    keywords: string[];
  };
  timestamp?: any;
  lastUpdateTimestamp?: any;
}

export type NFTBookListingInfoFiltered = z.infer<typeof NFTBookListingInfoFilteredSchema>;

export type AffiliateConfig = z.infer<typeof AffiliateConfigSchema>;

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
