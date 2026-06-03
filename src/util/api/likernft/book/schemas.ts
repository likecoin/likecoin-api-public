import { z } from 'zod';
import {
  MIN_BOOK_PRICE_DECIMAL,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  SUPPORTED_PLUS_CURRENCIES,
} from '../../../../constant';
import { BOOK_PRICE_OVERRIDE_CURRENCIES } from '../../../pricing';

const LocalizedTextMap = z.record(z.string(), z.string())
  .refine(
    (m) => typeof m[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string',
    { message: `default locale "${NFT_BOOK_TEXT_DEFAULT_LOCALE}" is required` },
  );

export const PriceInDecimalByCurrencySchema = z.record(
  z.enum(BOOK_PRICE_OVERRIDE_CURRENCIES),
  z.number().int().min(0),
);

export const NFTBookPriceSchema = z.object({
  priceInDecimal: z.number()
    .int()
    .min(0)
    .refine(
      (v) => v === 0 || v >= MIN_BOOK_PRICE_DECIMAL,
      { message: `priceInDecimal must be 0 or >= ${MIN_BOOK_PRICE_DECIMAL}` },
    ),
  priceInDecimalByCurrency: PriceInDecimalByCurrencySchema.optional(),
  stock: z.number().int().min(0),
  name: LocalizedTextMap,
  description: LocalizedTextMap,
  isAllowCustomPrice: z.boolean().optional(),
  isAutoDeliver: z.boolean().optional(),
  isUnlisted: z.boolean().optional(),
  autoMemo: z.string().optional(),
  order: z.number().int().optional(),
});

export const NFTBookPricesSchema = z.array(NFTBookPriceSchema).min(1);

export const PriceMutationBodySchema = z.object({
  price: NFTBookPriceSchema,
});

export const PriceReorderBodySchema = z.object({
  order: z.coerce.number().int().min(0),
});

const ConnectedWalletsSchema = z.record(z.string(), z.number().int().min(0));

export const ListingSettingsBodySchema = z.object({
  moderatorWallets: z.array(z.string()).optional(),
  connectedWallets: ConnectedWalletsSchema.nullish(),
  mustClaimToView: z.boolean().optional(),
  hideDownload: z.boolean().optional(),
  hideAudio: z.boolean().optional(),
  hideUpsell: z.boolean().optional(),
  enableCustomMessagePage: z.boolean().optional(),
  tableOfContents: z.string().optional(),
  isAdultOnly: z.boolean().optional(),
  isPlusReadingEnabled: z.boolean().optional(),
});

export const NewListingBodySchema = ListingSettingsBodySchema.extend({
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
  prices: NFTBookPricesSchema,
});

export const ImageUploadBodySchema = z.object({
  signedMessageText: z.string().optional(),
});

export const STRIPE_CONNECT_SITES = ['press', 'store'] as const;
export type StripeConnectSite = typeof STRIPE_CONNECT_SITES[number];

export const StripeConnectNewBodySchema = z.object({
  site: z.enum(STRIPE_CONNECT_SITES).optional(),
});

export const NFTBookSentBodySchema = z.object({
  txHash: z.string().nullish(),
  quantity: z.coerce.number().int().positive().default(1),
});

export const TrackingFieldsSchema = z.object({
  gaClientId: z.string().optional(),
  gaSessionId: z.string().optional(),
  gadClickId: z.string().optional(),
  gadSource: z.string().optional(),
  fbClickId: z.string().optional(),
  fbp: z.string().optional(),
  fbc: z.string().optional(),
  posthogDistinctId: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmContent: z.string().optional(),
  utmTerm: z.string().optional(),
  referrer: z.string().optional(),
  ipCountry: z.string().optional(),
  isApp: z.boolean().optional(),
  language: z.string().optional(),
});

export const BookGiftInfoBodySchema = z.object({
  fromName: z.string().optional(),
  toName: z.string().optional(),
  toEmail: z.string().email(),
  message: z.string().optional(),
}).passthrough();

export const BookPurchaseNewBodySchema = TrackingFieldsSchema.extend({
  email: z.string().email().optional(),
  giftInfo: BookGiftInfoBodySchema.optional(),
  coupon: z.string().optional(),
  currency: z.enum(SUPPORTED_PLUS_CURRENCIES).optional(),
  customPriceInDecimal: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().positive().default(1),
});

export const BookCartItemSchema = z.object({
  classId: z.string().min(1),
  priceIndex: z.coerce.number().int().min(0),
  customPriceInDecimal: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().positive().default(1),
  from: z.string().optional(),
});

export const BookCartNewBodySchema = TrackingFieldsSchema.extend({
  items: z.array(BookCartItemSchema).min(1),
  email: z.string().email().optional(),
  giftInfo: BookGiftInfoBodySchema.optional(),
  coupon: z.string().optional(),
  currency: z.enum(SUPPORTED_PLUS_CURRENCIES).optional(),
  cancelPage: z.string().optional(),
});

export const BookCartClaimBodySchema = z.object({
  wallet: z.string().min(1),
  message: z.string().optional(),
  loginMethod: z.string().optional(),
});

export const BookMessageBodySchema = z.object({
  wallet: z.string().min(1),
  message: z.string().min(1),
});

export const BookFreeClaimBodySchema = z.object({
  classId: z.string().min(1),
});

export const BookClassIdParamsSchema = z.object({
  classId: z.string().min(1),
});

export const BookClassIdPriceIndexParamsSchema = z.object({
  classId: z.string().min(1),
  priceIndex: z.coerce.number().int().min(0),
});

export const BookClassIdPaymentIdParamsSchema = z.object({
  classId: z.string().min(1),
  paymentId: z.string().min(1),
});

export const BookCartIdParamsSchema = z.object({
  cartId: z.string().min(1),
});

export const BookIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const BookSearchQuerySchema = z.object({
  q: z.string().optional(),
  fields: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

export const BookListPaginationQuerySchema = z.object({
  before: z.coerce.number().int().optional(),
  key: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100)
    .default(10),
});
export type BookListPaginationQuery = z.infer<typeof BookListPaginationQuerySchema>;

export const BookListQuerySchema = BookListPaginationQuerySchema.extend({
  wallet: z.string().optional(),
  chain: z.string().optional(),
  exclude_wallet: z.string().optional(),
});
export type BookListQuery = z.infer<typeof BookListQuerySchema>;

export const BookCatalogMetaQuerySchema = z.object({
  format: z.string().optional(),
}).passthrough();

export const BookConnectStatusQuerySchema = z.object({
  wallet: z.string().optional(),
}).passthrough();

export const BookCMSTagIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

const BookCMSLocalizedStringSchema = z.object({
  zh: z.string(),
  en: z.string(),
});

export const BookCMSTagSyncBodySchema = z.object({
  tagIds: z.array(BookCMSTagIdSchema),
});

export const BookCMSTagBulkBodySchema = z.object({
  entries: z.array(z.object({
    classId: z.string().min(1),
    tagId: BookCMSTagIdSchema,
    // Non-negative integer (matches the `>= 0` filter on cmsTags.<tagId> in /cms/list);
    // null means delete the entry.
    order: z.number().int().min(0).nullable(),
  })),
});

export const BookCMSTagUpsertBodySchema = z.object({
  name: BookCMSLocalizedStringSchema,
  description: BookCMSLocalizedStringSchema,
  order: z.string(),
  isPublic: z.boolean(),
});

export const BookCMSTagIdParamsSchema = z.object({
  tagId: BookCMSTagIdSchema,
});

export const BookCMSTagListQuerySchema = z.object({
  tag: BookCMSTagIdSchema,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100)
    .default(10),
});
export type BookCMSTagListQuery = z.infer<typeof BookCMSTagListQuerySchema>;

export const ClassIdResponseSchema = z.object({
  classId: z.string(),
});

export const NewListingResponseSchema = ClassIdResponseSchema;
export const ListingSettingsResponseSchema = ClassIdResponseSchema;

export const StripeCheckoutResponseSchema = z.object({
  paymentId: z.string(),
  url: z.string().url().nullable(),
});

export const BookPurchaseNewResponseSchema = StripeCheckoutResponseSchema;
export const BookCartNewResponseSchema = StripeCheckoutResponseSchema;

export const BookCartClaimResponseSchema = z.object({
  classIds: z.array(z.string()),
  newClaimedNFTs: z.array(z.object({
    classId: z.string(),
    nftId: z.string().optional(),
  })),
  allItemsAutoClaimed: z.boolean(),
  errors: z.array(z.object({
    classId: z.string(),
    error: z.string(),
  })),
});

export const BookFreeClaimResponseSchema = z.object({
  classIds: z.array(z.string()),
  cartId: z.string(),
  paymentId: z.string(),
  claimToken: z.string(),
});

export const PriceCreateResponseSchema = z.object({
  index: z.number().int().min(0),
});

export const ImageUploadResponseSchema = z.object({
  enableSignatureImage: z.boolean(),
  signedMessageText: z.string(),
});

export const StripeConnectNewResponseSchema = z.object({
  url: z.string().url(),
});

const LocalizedOrPlainTextSchema = z.union([
  z.string(),
  z.record(z.string(), z.string()),
]);

export const NFTBookPriceFilteredSchema = z.object({
  index: z.number().int().min(0),
  price: z.number(),
  priceInDecimalByCurrency: PriceInDecimalByCurrencySchema.optional(),
  name: LocalizedOrPlainTextSchema.optional(),
  description: LocalizedOrPlainTextSchema.optional(),
  stock: z.number().int(),
  isSoldOut: z.boolean(),
  isAutoDeliver: z.boolean().optional(),
  isUnlisted: z.boolean().optional(),
  autoMemo: z.string().optional(),
  isAllowCustomPrice: z.boolean().optional(),
  isTippingEnabled: z.boolean().optional(),
  order: z.number().int(),
  sold: z.number().int().optional(),
});

export const NFTBookPricesInfoFilteredSchema = z.object({
  sold: z.number().int(),
  stock: z.number().int(),
  prices: z.array(NFTBookPriceFilteredSchema),
});

export const NFTBookListingInfoFilteredSchema = z.object({
  id: z.string(),
  classId: z.string(),
  likeClassId: z.string().optional(),
  evmClassId: z.string().optional(),
  redirectClassId: z.string().optional(),
  chain: z.string().optional(),
  prices: z.array(NFTBookPriceFilteredSchema),
  minPrice: z.number().optional(),
  isSoldOut: z.boolean(),
  stock: z.number().int(),
  ownerWallet: z.string(),
  mustClaimToView: z.boolean().optional(),
  hideDownload: z.boolean().optional(),
  hideAudio: z.boolean().optional(),
  hideUpsell: z.boolean().optional(),
  enableCustomMessagePage: z.boolean().optional(),
  tableOfContents: z.unknown().optional(),
  signedMessageText: z.string().optional(),
  enableSignatureImage: z.boolean().optional(),
  recommendedClassIds: z.array(z.string()).optional(),
  inLanguage: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  descriptionFull: z.string().optional(),
  previewContent: z.string().optional(),
  descriptionSummary: z.string().optional(),
  promotionalImages: z.array(z.string()).optional(),
  promotionalVideos: z.array(z.string()).optional(),
  reviewTitle: z.string().optional(),
  reviewURL: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  thumbnailUrl: z.string().optional(),
  author: z.string().optional(),
  usageInfo: z.string().optional(),
  isbn: z.string().optional(),
  genre: z.string().optional(),
  timestamp: z.number().optional(),
  isHidden: z.boolean().optional(),
  isAdultOnly: z.boolean().optional(),
  sold: z.number().int().optional(),
  pendingNFTCount: z.number().int().optional(),
  moderatorWallets: z.array(z.string()).optional(),
  connectedWallets: z.unknown().optional(),
  isApprovedForSale: z.boolean(),
  isApprovedForIndexing: z.boolean(),
  isApprovedForAds: z.boolean(),
  approvalStatus: z.string().optional(),
  plusPromoEnabled: z.boolean().optional(),
  isPlusReadingEnabled: z.boolean().optional(),
});

export const BookGiftInfoSchema = z.object({
  fromName: z.string(),
  toName: z.string(),
  toEmail: z.string(),
  message: z.string().optional(),
}).passthrough();

export const BookPurchaseDataFilteredSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  sessionId: z.string().optional(),
  isPendingClaim: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  errorMessage: z.string().optional(),
  wallet: z.string().optional(),
  classId: z.string().optional(),
  priceInDecimal: z.number().optional(),
  price: z.number().optional(),
  originalPrice: z.number().optional(),
  originalPriceInDecimal: z.number().optional(),
  priceIndex: z.number().int().optional(),
  priceName: z.string().optional(),
  coupon: z.string().optional(),
  txHash: z.string().optional(),
  message: z.string().optional(),
  from: z.string().optional(),
  giftInfo: BookGiftInfoSchema.optional(),
  timestamp: z.number().optional(),
  autoMemo: z.string().optional(),
  isAutoDeliver: z.boolean().optional(),
  quantity: z.number().int(),
  classIds: z.array(z.string()).optional(),
  classIdsWithPrice: z.array(z.unknown()).optional(),
});

export const BookPurchaseCommissionFilteredSchema = z.object({
  type: z.string(),
  ownerWallet: z.string(),
  classId: z.string().optional(),
  priceIndex: z.number().int().optional(),
  collectionId: z.string().optional(),
  transferId: z.string().optional(),
  stripeConnectAccountId: z.string().optional(),
  paymentId: z.string(),
  amountTotal: z.number(),
  amount: z.number(),
  currency: z.string(),
  buyerEmail: z.string().optional(),
  timestamp: z.number().optional(),
});

export const BookSearchResponseSchema = z.object({
  // queryAirtableForPublication returns null when the Airtable lookup errors.
  list: z.array(z.unknown()).nullable(),
});

export const BookListResponseSchema = z.object({
  list: z.array(NFTBookListingInfoFilteredSchema),
  nextKey: z.number().nullable(),
});

export const BookListModeratedResponseSchema = z.object({
  list: z.array(z.object({
    classId: z.string(),
    prices: z.array(NFTBookPriceFilteredSchema),
    pendingNFTCount: z.number().int().optional(),
    stock: z.number().int(),
    sold: z.number().int(),
    ownerWallet: z.string(),
  })),
});

// Response mirrors the upsert body plus the server-assigned id and timestamps.
export const BookCMSTagResponseSchema = BookCMSTagUpsertBodySchema.extend({
  id: BookCMSTagIdSchema,
  // serializeCMSTagDoc converts Firestore Timestamps to millis; absent on legacy docs.
  timestamp: z.number().optional(),
  lastUpdateTimestamp: z.number().optional(),
});

export const BookCMSTagListResponseSchema = z.object({
  list: z.array(BookCMSTagResponseSchema),
});

export const BookCMSTagBulkResponseSchema = z.object({
  updated: z.number().int().min(0),
  // Per-classId failure map, only present when at least one update failed.
  errors: z.record(z.string(), z.string()).optional(),
});

export const BookCMSTagBookListResponseSchema = z.object({
  list: z.array(NFTBookListingInfoFilteredSchema),
  nextOffset: z.number().nullable(),
});

export const BookInfoResponseSchema = NFTBookListingInfoFilteredSchema;

export const BookPriceInfoResponseSchema = NFTBookPriceFilteredSchema.extend({
  ownerWallet: z.string(),
});

export const BookOrdersResponseSchema = z.object({
  orders: z.array(BookPurchaseDataFilteredSchema),
});

export const BookStatusResponseSchema = BookPurchaseDataFilteredSchema;

export const BookCartStatusResponseSchema = BookPurchaseDataFilteredSchema;

export const BookFreeClaimableListResponseSchema = z.array(z.string());

export const BookPurchaseMessagesResponseSchema = z.object({
  messages: z.array(BookPurchaseDataFilteredSchema.pick({
    wallet: true,
    txHash: true,
    timestamp: true,
    message: true,
  })),
});

export const BookUserProfileResponseSchema = z.object({
  stripeConnectAccountId: z.string().optional(),
  isStripeConnectReady: z.boolean().optional(),
  notificationEmail: z.string().nullable(),
  isEmailVerified: z.boolean(),
});

export const BookUserConnectStatusResponseSchema = z.object({
  hasAccount: z.boolean(),
  isReady: z.boolean().optional(),
  stripeConnectAccountId: z.string().optional(),
  email: z.string().optional(),
});
export type BookUserConnectStatusResponse = z.infer<typeof BookUserConnectStatusResponseSchema>;

export const BookUserCommissionsResponseSchema = z.object({
  commissions: z.array(BookPurchaseCommissionFilteredSchema),
});

const StripePayoutSummarySchema = z.object({
  amount: z.number(),
  currency: z.string(),
  id: z.string(),
  status: z.string(),
  arrivalTs: z.number(),
  createdTs: z.number(),
});

export const BookUserPayoutsListResponseSchema = z.object({
  payouts: z.array(StripePayoutSummarySchema),
});

export const BookUserPayoutResponseSchema = StripePayoutSummarySchema.extend({
  items: z.array(z.object({
    amount: z.number(),
    currency: z.string(),
    status: z.string(),
    createdTs: z.number(),
    description: z.string().nullable(),
    commissionId: z.string().nullable(),
    metadata: z.record(z.string(), z.string()).optional(),
  })),
});
