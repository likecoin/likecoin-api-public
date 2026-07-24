import { z } from 'zod';
import { LIKER_PLUS_TIERS, SUPPORTED_CHECKOUT_UI_MODES } from '../../../constant';
import { EVM_ADDRESS_REGEX } from '../../evm';
import {
  BookGiftInfoBodySchema,
  BookGiftInfoSchema,
  StripeCheckoutResponseSchema,
  TrackingFieldsSchema,
} from '../likernft/book/schemas';
import { PLUS_READING_ALLOCATION_MODES } from './settle';

const TrialPeriodDaysSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(14),
  z.literal(30),
]);

const GiftPriceIndexSchema = z.string();

export const PlusNewBodySchema = TrackingFieldsSchema.extend({
  coupon: z.string().optional(),
  trialPeriodDays: TrialPeriodDaysSchema.optional(),
  mustCollectPaymentMethod: z.boolean().optional(),
  giftClassId: z.string().optional(),
  giftPriceIndex: GiftPriceIndexSchema.optional(),
  uiMode: z.enum(SUPPORTED_CHECKOUT_UI_MODES).optional(),
});

export const PlusPriceBodySchema = z.object({
  period: z.enum(['monthly', 'yearly']),
  // Target tier; omitted keeps the subscription's current tier.
  tier: z.enum(LIKER_PLUS_TIERS).optional(),
  giftClassId: z.string().optional(),
  giftPriceIndex: GiftPriceIndexSchema.optional(),
});

export const PlusGiftNewBodySchema = TrackingFieldsSchema.extend({
  coupon: z.string().optional(),
  giftInfo: BookGiftInfoBodySchema,
});

// Shared-membership seat invite (POST /plus/shared/members): the member's email
// is the invite identity; name/message only personalize the invite email.
export const PlusSharedMemberNewBodySchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  message: z.string().optional(),
});

export const PlusSharedMemberNewResponseSchema = z.object({
  inviteId: z.string(),
  remainingSeats: z.number().int().min(0),
});

// Shared-membership seat usage (GET /plus/shared/members): revoked invites free
// their seat, so only pending/claimed invites are listed and counted.
export const PlusSharedMembersResponseSchema = z.object({
  used: z.number().int().min(0),
  total: z.number().int(),
  remaining: z.number().int().min(0),
  members: z.array(z.object({
    inviteId: z.string(),
    email: z.string(),
    name: z.string().optional(),
    status: z.enum(['pending', 'claimed']),
    timestamp: z.number().optional(),
    claimTimestamp: z.number().optional(),
  })),
});

// Claim a member seat (POST /plus/shared/members/claim). giverLikerId addresses
// the invite directly (no collection-group lookup); token authorizes the claim.
export const PlusSharedMemberClaimBodySchema = z.object({
  giverLikerId: z.string().min(1),
  inviteId: z.string().min(1),
  token: z.string().min(1),
});

export const PlusSharedMemberInviteIdParamsSchema = z.object({
  inviteId: z.string().min(1),
});

export const PlusCartIdParamsSchema = z.object({
  cartId: z.string().min(1),
});

export const PlusAffiliateParamsSchema = z.object({
  likerId: z.string().min(1),
});

// `.catch()` keeps the endpoints' historically lenient behaviour: a missing or
// invalid `period` falls back to the default instead of returning 400.
export const PlusNewQuerySchema = z.object({
  period: z.enum(['monthly', 'yearly']).default('monthly').catch('monthly'),
  tier: z.enum(LIKER_PLUS_TIERS).default('plus').catch('plus'),
  from: z.string().optional(),
  currency: z.string().optional(),
}).passthrough();

export const PlusGiftNewQuerySchema = z.object({
  period: z.enum(['monthly', 'yearly']).default('yearly').catch('yearly'),
  from: z.string().optional(),
  currency: z.string().optional(),
}).passthrough();

export const PlusCheckoutResponseSchema = StripeCheckoutResponseSchema.extend({
  sessionId: z.string(),
  clientSecret: z.string().nullable().optional(),
});

export const PlusNewResponseSchema = PlusCheckoutResponseSchema;
export const PlusGiftNewResponseSchema = PlusCheckoutResponseSchema;

export const PlusPortalResponseSchema = z.object({
  sessionId: z.string(),
  url: z.string().url(),
});

// Fields are optional to tolerate legacy/partial affiliate records: entries
// saved before these were required must still pass response validation rather
// than 500 the whole endpoint. Consumers filter out entries they can't use.
const AffiliateGiftBookSchema = z.object({
  classId: z.string().optional(),
  priceIndex: z.number().int().min(0),
});

const AffiliateCustomVoiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  language: z.string().optional(),
  avatarUrl: z.string().optional(),
  providerVoiceId: z.string().optional(),
});

export const AffiliateConfigSchema = z.object({
  active: z.boolean(),
  affiliateClassIds: z.array(z.string()),
  affiliatePublisherWallets: z.array(z.string()).optional(),
  giftBooks: z.array(AffiliateGiftBookSchema).optional(),
  giftOnTrial: z.boolean(),
  customVoices: z.array(AffiliateCustomVoiceSchema),
});

const PlusAffiliateInactiveSchema = z.object({
  active: z.literal(false),
  isPlusDiscountAllowed: z.boolean(),
});

const PlusAffiliateActiveSchema = AffiliateConfigSchema.omit({ active: true }).extend({
  active: z.literal(true),
  affiliatePublisherWallets: z.array(z.string()),
  giftBooks: z.array(AffiliateGiftBookSchema),
  isPlusDiscountAllowed: z.boolean(),
});

export const PlusAffiliateResponseSchema = z.discriminatedUnion('active', [
  PlusAffiliateInactiveSchema,
  PlusAffiliateActiveSchema,
]);

// All active affiliate voice configs (GET /plus/voices) — the Civic premium
// voice pool. Voice/scope fields mirror the public per-likerId affiliate view.
export const PlusVoicesResponseSchema = z.object({
  affiliates: z.array(z.object({
    likerId: z.string(),
    affiliateClassIds: z.array(z.string()),
    affiliatePublisherWallets: z.array(z.string()),
    customVoices: z.array(AffiliateCustomVoiceSchema),
  })),
});

// Self view: the authenticated user's effective affiliate-voice sources. A Plus
// subscriber draws voices from their `plusAffiliateFrom` affiliate; if the user
// is themselves an active affiliate, their own config is added too (self first).
const affiliateSourceFields = { likerId: z.string(), isSelf: z.boolean() };
export const PlusSelfAffiliateEntrySchema = z.discriminatedUnion('active', [
  PlusAffiliateInactiveSchema.extend(affiliateSourceFields),
  PlusAffiliateActiveSchema.extend(affiliateSourceFields),
]);

export const PlusSelfAffiliateResponseSchema = z.object({
  affiliates: z.array(PlusSelfAffiliateEntrySchema),
});

export type PlusSelfAffiliateEntry = z.infer<typeof PlusSelfAffiliateEntrySchema>;

export const PlusGiftStatusResponseSchema = z.object({
  giftClassId: z.string().optional(),
  giftCartId: z.string().optional(),
  giftPaymentId: z.string().optional(),
  giftClaimToken: z.string().optional(),
  affiliateFrom: z.string().optional(),
});

export const PlusGiftCartStatusResponseSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  status: z.enum(['paid', 'pending', 'completed', 'error']).optional(),
  sessionId: z.string().optional(),
  errorMessage: z.string().optional(),
  wallet: z.string().optional(),
  period: z.enum(['monthly', 'yearly']),
  giftInfo: BookGiftInfoSchema,
  timestamp: z.number().optional(),
  claimTimestamp: z.number().optional(),
});

// Response contract for GET /plus/revenuecat/config: the canonical app_user_id
// (our internal user id) the mobile app passes to Purchases.logIn(), plus the
// RevenueCat entitlement that grants Liker Plus.
export const RevenueCatConfigResponseSchema = z.object({
  appUserId: z.string(),
  entitlementId: z.string(),
});

// RevenueCat webhook body. Deliberately lenient: the request is authorized by the
// shared-secret header (the real trust boundary), and a 400 here can drop a real
// event. `event` itself is optional (the handler no-ops when it's missing); when
// present, only `event.type` is required and everything else is .nullish() with
// .passthrough(). Two checks against the official docs (verified against
// revenuecat.com/docs/.../event-types-and-fields):
//   - period_type/environment/store are plain strings, not enums — RevenueCat ships
//     values our TS interface omits (e.g. period_type PREPAID), and an enum would
//     reject those valid deliveries.
//   - product_id/price/price_in_purchased_currency/currency are explicitly nullable
//     in the docs, so every scalar is .nullish() (accepts null AND missing).
export const RevenueCatWebhookBodySchema = z.object({
  event: z.object({
    type: z.string(),
    id: z.string().nullish(),
    app_user_id: z.string().nullish(),
    aliases: z.array(z.string()).nullish(),
    original_app_user_id: z.string().nullish(),
    product_id: z.string().nullish(),
    entitlement_id: z.string().nullish(),
    entitlement_ids: z.array(z.string()).nullish(),
    period_type: z.string().nullish(),
    purchased_at_ms: z.number().nullish(),
    expiration_at_ms: z.number().nullish(),
    store: z.string().nullish(),
    environment: z.string().nullish(),
    price: z.number().nullish(),
    price_in_purchased_currency: z.number().nullish(),
    currency: z.string().nullish(),
    original_transaction_id: z.string().nullish(),
    cancel_reason: z.string().nullish(),
    expiration_reason: z.string().nullish(),
    transferred_from: z.array(z.string()).nullish(),
    transferred_to: z.array(z.string()).nullish(),
    subscriber_attributes: z.record(z.string(), z.object({
      value: z.string().nullish(),
      updated_at_ms: z.number().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().optional(),
}).passthrough();

// Internal Plus reading-usage ingest (POST /plus/reading/usage), called
// server-to-server by 3ook.com. Durations are already paced (anti-fraud)
// upstream; cap each at 4h — the reader's per-session ceiling — as a sanity bound.
const MAX_USAGE_DELTA_MS = 4 * 60 * 60 * 1000;
const UsageDurationSchema = z.number().int().min(0).max(MAX_USAGE_DELTA_MS);
// Cap a batched forward so one request can't fan out into an unbounded write set.
const MAX_USAGE_BATCH = 100;

const PlusReadingUsageEntrySchema = z.object({
  // Idempotency key: the ledger increments are non-idempotent, so the API dedups
  // retries of the same delta (see recordPlusReadingUsage) — that's what lets the
  // forwarder retry a dropped request without double-counting. Optional: a forwarder
  // that omits it simply gets no dedup (and must not enable retry).
  // Reject `/` so a bad id can't become an invalid Firestore doc path (a 500 instead
  // of a clean 400) when used as `.doc(id)`.
  id: z.string().min(1).max(200).regex(/^[^/]+$/, 'INVALID_ID')
    .optional(),
  readerWallet: z.string().regex(EVM_ADDRESS_REGEX, 'INVALID_READER_WALLET'),
  classId: z.string().regex(EVM_ADDRESS_REGEX, 'INVALID_CLASS_ID'),
  // Rev-share-eligible (paid Plus, borrowed) durations that fund the payout pool.
  readingTimeMs: UsageDurationSchema,
  ttsTimeMs: UsageDurationSchema,
  // Non-rev-share engagement (owned copies, trial/non-Plus reads). Recorded for
  // publisher stats only; settlement never reads these. Default 0 so an older
  // forwarder that omits them keeps working.
  nonLibraryReadingTimeMs: UsageDurationSchema.default(0),
  nonLibraryTtsTimeMs: UsageDurationSchema.default(0),
  occurredAt: z.number().int().positive().optional(),
});

// Accept a single entry (legacy flat body) or a batch. Backward compatible: an old
// forwarder's flat body still validates as one entry; the `entries` form lets a
// future coalescer flush several deltas in one request.
export const PlusReadingUsageBodySchema = z.union([
  PlusReadingUsageEntrySchema,
  z.object({ entries: z.array(PlusReadingUsageEntrySchema).min(1).max(MAX_USAGE_BATCH) }),
]);

export const PlusReadingUsageResponseSchema = z.object({
  success: z.literal(true),
  // Legacy convenience: the first entry's dayId. Batch callers should read `results`.
  dayId: z.string(),
  // Per-entry outcome; `applied: false` means a no-op or a deduped retry.
  results: z.array(z.object({ dayId: z.string(), applied: z.boolean() })),
});

// A settlement/report period: a whole month (`YYYY-MM`) or a single day (`YYYY-MM-DD`).
// The `.refine` rejects impossible calendar days (e.g. 2026-02-30) — a YYYY-MM-DD id must
// round-trip through Date.UTC unchanged. Month-only ids have no day to validate.
export const PeriodIdSchema = z.string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, 'INVALID_PERIOD_ID')
  .refine((id) => {
    const [y, m, d] = id.split('-').map(Number);
    if (d === undefined) return true;
    return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
  }, 'INVALID_PERIOD_ID');

// Admin Plus reading revenue-share settle (POST /plus/admin/reading/settle).
export const PlusSettleBodySchema = z.object({
  periodId: PeriodIdSchema,
  dryRun: z.boolean().optional(),
  mode: z.enum(PLUS_READING_ALLOCATION_MODES).optional(),
});

export const PlusSettleResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean(),
  periodId: z.string(),
  mode: z.enum(PLUS_READING_ALLOCATION_MODES),
  revShareRate: z.number(),
  poolUSD: z.number(),
  allocatableUSD: z.number(),
  allocatedUSD: z.number(),
  revSharePct: z.number(),
  readRatePerMin: z.number(),
  ttsRatePerMin: z.number(),
  totalReadingTimeMs: z.number(),
  totalTTSTimeMs: z.number(),
  bookCount: z.number(),
  // Unique library readers in the period. Non-library/free-book reads spawn no reader
  // docs, so this undercounts vs publisher engagement stats.
  readerCount: z.number(),
  paidCount: z.number(),
  pendingCount: z.number(),
  paidCents: z.number(),
  pendingCents: z.number(),
  books: z.array(z.object({
    classId: z.string(),
    amountCents: z.number(),
    readingTimeMs: z.number(),
    ttsTimeMs: z.number(),
    // Per-book unique readers; a reader of N books counts in each, so these can sum
    // past the top-level readerCount.
    readerCount: z.number(),
  })),
});

// Admin Plus reading pending-payout sweep (POST /plus/admin/reading/sweep).
export const PlusSweepBodySchema = z.object({
  dryRun: z.boolean().optional(),
});

export const PlusSweepResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean(),
  sweptCount: z.number(),
  paidCount: z.number(),
  stillPendingCount: z.number(),
  paidCents: z.number(),
});

// Publisher Plus reading revenue-share report (GET /likernft/book/user/plus-reading/report).
export const PlusReadingReportQuerySchema = z.object({
  period: PeriodIdSchema.optional(),
});

const PlusReadingReportEntrySchema = z.object({
  periodId: z.string(),
  classId: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  status: z.enum(['paid', 'pending']),
  readingTimeMs: z.number(),
  ttsTimeMs: z.number(),
  readRatePerMin: z.number(),
  ttsRatePerMin: z.number(),
  transferId: z.string().optional(),
  updatedAt: z.number().optional(),
});

export const PlusReadingReportResponseSchema = z.object({
  payouts: z.array(PlusReadingReportEntrySchema),
  summary: z.object({
    totalCents: z.number(),
    paidCents: z.number(),
    pendingCents: z.number(),
    periodCount: z.number(),
    bookCount: z.number(),
  }),
});

// Publisher Plus reading engagement stats (GET /likernft/book/user/plus-reading/stats).
export const PlusReadingStatsQuerySchema = z.object({
  period: PeriodIdSchema.optional(),
  classId: z.string().regex(EVM_ADDRESS_REGEX, 'INVALID_CLASS_ID').optional(),
});

const PlusReadingStatsEntrySchema = z.object({
  classId: z.string(),
  periodId: z.string(),
  readingTimeMs: z.number(),
  ttsTimeMs: z.number(),
  nonLibraryReadingTimeMs: z.number(),
  nonLibraryTtsTimeMs: z.number(),
});

export const PlusReadingStatsResponseSchema = z.object({
  stats: z.array(PlusReadingStatsEntrySchema),
  summary: z.object({
    totalReadingTimeMs: z.number(),
    totalTTSTimeMs: z.number(),
    totalNonLibraryReadingTimeMs: z.number(),
    totalNonLibraryTTSTimeMs: z.number(),
    bookCount: z.number(),
    periodCount: z.number(),
  }),
});
