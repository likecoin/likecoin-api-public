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

// EVM auto-deliver books use a numeric placeholder (0); Cosmos NFTs use string ids.
const NFTIdSchema = z.union([z.string(), z.number()]).optional();

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
  descriptionFull: z.string().optional(),
  isAdultOnly: z.boolean().optional(),
  isPlusReadingEnabled: z.boolean().optional(),
  isPreviewEnabled: z.boolean().optional(),
  previewPercentage: z.number().int().min(1).max(50)
    .optional(),
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
  library: z.literal('1').optional(),
  before: z.coerce.number().int().optional(),
  key: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100)
    .default(10),
});
export type BookListPaginationQuery = z.infer<typeof BookListPaginationQuerySchema>;

export const BookListQuerySchema = BookListPaginationQuerySchema.extend({
  wallet: z.string().optional(),
  chain: z.string().default('base'),
});
export type BookListQuery = z.infer<typeof BookListQuerySchema>;

// Scopes and paginates like its `/list*` siblings, except the cursor is the previous page's
// last class id rather than a timestamp — ranking ties can't be resumed from a value alone.
export const BookPopularListQuerySchema = BookListPaginationQuerySchema
  .omit({ before: true, key: true })
  .extend({
    // Cursor is a class id (EVM `0x…` or legacy Cosmos `likenft1…`); restrict to an
    // alphanumeric charset so a stray `/` can't make Firestore's `.doc()` throw a 500.
    key: z.string().regex(/^[a-zA-Z0-9]+$/).optional(),
  });
export type BookPopularListQuery = z.infer<typeof BookPopularListQuerySchema>;

// Shared by the Meta, OpenAI, and Stripe catalog routes — output is selected via `format`.
export const BookCatalogQuerySchema = z.object({
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
  isForLibrary: z.boolean().default(false),
  isForStore: z.boolean().default(false),
});

export const BookCMSTagIdParamsSchema = z.object({
  tagId: BookCMSTagIdSchema,
});

export const BookCMSTagListQuerySchema = z.object({
  tag: BookCMSTagIdSchema,
  library: z.literal('1').optional(),
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
    nftId: NFTIdSchema,
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

// author/publisher are stored as a plain string on legacy docs, an object on newer ones.
export const BookContributorSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
  }).passthrough(),
]);

// `true` once a signature image is attached; the literal 'signed' marks docs whose
// signature was applied without an uploaded image. Shared so the response schema and
// the NFTBookListingInfo source type can't drift apart.
export const BookSignatureImageSchema = z.union([z.boolean(), z.literal('signed')]);

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
  enableSignatureImage: BookSignatureImageSchema.optional(),
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
  author: BookContributorSchema.optional(),
  usageInfo: z.string().optional(),
  isbn: z.string().optional(),
  publisher: BookContributorSchema.optional(),
  genre: z.string().optional(),
  timestamp: z.number().optional(),
  isHidden: z.boolean().optional(),
  isPendingReview: z.boolean().optional(),
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
  isPreviewEnabled: z.boolean().optional(),
  previewPercentage: z.number().int().min(1).max(50)
    .optional(),
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
  txHash: z.string().nullish(),
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
  // Legacy commission docs predate the ownerWallet field.
  ownerWallet: z.string().optional(),
  classId: z.string().optional(),
  priceIndex: z.number().int().optional(),
  collectionId: z.string().optional(),
  transferId: z.string().optional(),
  stripeConnectAccountId: z.string().optional(),
  paymentId: z.string(),
  amountTotal: z.number(),
  amount: z.number(),
  currency: z.string(),
  // Backfilled commission docs may have no classId, only a description.
  description: z.string().optional(),
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

export const BookPopularListResponseSchema = BookListResponseSchema.extend({
  nextKey: z.string().nullable(),
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
  email: z.string().nullable().optional(),
});
export type BookUserConnectStatusResponse = z.infer<typeof BookUserConnectStatusResponseSchema>;

export const BookUserCommissionsResponseSchema = z.object({
  commissions: z.array(BookPurchaseCommissionFilteredSchema),
});

// Stripe Connect onboarding-refresh returns only the readiness flag.
export const BookUserConnectRefreshResponseSchema = z.object({
  isReady: z.boolean(),
});

// claimNFTBook returns the claimed NFT id (absent when nothing was auto-minted).
export const BookClaimResponseSchema = z.object({
  nftId: NFTIdSchema,
});

// Mirrors MetaCatalogItem (src/util/api/likernft/book/metaCatalog.ts); Meta feed
// field names are snake_case per spec.
export const BookCatalogMetaResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    availability: z.enum(['in stock', 'out of stock']),
    condition: z.literal('new'),
    price: z.string(),
    link: z.string(),
    image_link: z.string(),
    brand: z.string(),
    item_group_id: z.string(),
    google_product_category: z.string(),
    fb_product_category: z.string(),
    gtin: z.string().optional(),
    custom_label_0: z.string().optional(),
    custom_label_1: z.string().optional(),
    custom_label_2: z.string().optional(),
  })),
});

// Mirrors the OpenAI commerce API product schema (Product → Variant) built in
// src/util/api/likernft/book/openaiCatalog.ts. Field names are snake_case per spec.
const OpenAICatalogMediaSchema = z.object({
  type: z.literal('image'),
  url: z.string(),
});
export const BookCatalogOpenAIResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.object({ plain: z.string() }),
    url: z.string(),
    media: z.array(OpenAICatalogMediaSchema),
    variants: z.array(z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      price: z.object({
        amount: z.number(),
        currency: z.string(),
      }),
      availability: z.object({
        available: z.boolean(),
        status: z.enum(['in_stock', 'out_of_stock']),
      }),
      condition: z.array(z.string()),
      categories: z.array(z.object({ name: z.string() })),
      media: z.array(OpenAICatalogMediaSchema),
      barcodes: z.array(z.object({
        type: z.string(),
        value: z.string(),
      })).optional(),
    })),
  })),
});

// Mirrors OpenAIFeedItem (openaiCatalog.ts) — the flat file-upload feed. Boolean
// and list fields are emitted as strings so one item serializes to CSV or JSON.
export const BookCatalogOpenAIFeedResponseSchema = z.object({
  products: z.array(z.object({
    item_id: z.string(),
    title: z.string(),
    description: z.string(),
    url: z.string(),
    brand: z.string(),
    image_url: z.string(),
    price: z.string(),
    availability: z.enum(['in_stock', 'out_of_stock']),
    condition: z.string(),
    product_category: z.string(),
    group_id: z.string(),
    listing_has_variations: z.string(),
    is_digital: z.string(),
    is_eligible_search: z.string(),
    is_eligible_checkout: z.string(),
    seller_name: z.string(),
    seller_url: z.string(),
    return_policy: z.string(),
    store_country: z.string(),
    target_countries: z.string().optional(),
    gtin: z.string().optional(),
  })),
});

// Mirrors StripeFeedItem (stripeCatalog.ts) — the Stripe Agentic Commerce feed.
// Google-Shopping field dialect; boolean fields are strings so one item
// serializes to CSV or JSON.
export const BookCatalogStripeResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    link: z.string(),
    image_link: z.string(),
    price: z.string(),
    availability: z.enum(['in_stock', 'out_of_stock']),
    inventory_not_tracked: z.string(),
    condition: z.string(),
    brand: z.string(),
    google_product_category: z.string(),
    item_group_id: z.string(),
    item_group_title: z.string(),
    disable_checkout: z.string(),
    gtin: z.string().optional(),
    stripe_product_tax_code: z.string().optional(),
  })),
});

// Mirrors GoogleMerchantItem (googleMerchantCatalog.ts) — the Google Merchant
// Center product feed. Google-Shopping field dialect; the XML feed is the
// primary representation, this JSON mirror backs `?format=json` for debugging.
export const BookCatalogGoogleResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    link: z.string(),
    image_link: z.string(),
    price: z.string(),
    availability: z.enum(['in_stock', 'out_of_stock']),
    condition: z.literal('new'),
    brand: z.string(),
    google_product_category: z.string(),
    gtin: z.string().optional(),
    identifier_exists: z.literal('no').optional(),
    item_group_id: z.string().optional(),
    item_group_title: z.string().optional(),
  })),
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
