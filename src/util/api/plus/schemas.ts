import { z } from 'zod';
import { SUPPORTED_CHECKOUT_UI_MODES } from '../../../constant';
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
  giftClassId: z.string().optional(),
  giftPriceIndex: GiftPriceIndexSchema.optional(),
});

export const PlusGiftNewBodySchema = TrackingFieldsSchema.extend({
  coupon: z.string().optional(),
  giftInfo: BookGiftInfoBodySchema,
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

const AffiliateGiftBookSchema = z.object({
  classId: z.string(),
  priceIndex: z.number().int().min(0),
});

const AffiliateCustomVoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string().optional(),
  avatarUrl: z.string().optional(),
  providerVoiceId: z.string(),
});

export const AffiliateConfigSchema = z.object({
  active: z.boolean(),
  affiliateClassIds: z.array(z.string()),
  affiliatePublisherWallets: z.array(z.string()).optional(),
  giftBooks: z.array(AffiliateGiftBookSchema).optional(),
  giftOnTrial: z.boolean(),
  customVoices: z.array(AffiliateCustomVoiceSchema),
});

export const PlusAffiliateResponseSchema = z.discriminatedUnion('active', [
  z.object({
    active: z.literal(false),
    isPlusDiscountAllowed: z.boolean(),
  }),
  AffiliateConfigSchema.omit({ active: true }).extend({
    active: z.literal(true),
    affiliatePublisherWallets: z.array(z.string()),
    giftBooks: z.array(AffiliateGiftBookSchema),
    isPlusDiscountAllowed: z.boolean(),
  }),
]);

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

// Internal Plus reading-usage ingest (POST /plus/reading/usage), called
// server-to-server by 3ook.com. Durations are already paced (anti-fraud)
// upstream; cap each at 4h — the reader's per-session ceiling — as a sanity bound.
const MAX_USAGE_DELTA_MS = 4 * 60 * 60 * 1000;
const UsageDurationSchema = z.number().int().min(0).max(MAX_USAGE_DELTA_MS);

export const PlusReadingUsageBodySchema = z.object({
  readerWallet: z.string().regex(EVM_ADDRESS_REGEX, 'INVALID_READER_WALLET'),
  classId: z.string().regex(EVM_ADDRESS_REGEX, 'INVALID_CLASS_ID'),
  readingTimeMs: UsageDurationSchema,
  ttsTimeMs: UsageDurationSchema,
  occurredAt: z.number().int().positive().optional(),
});

export const PlusReadingUsageResponseSchema = z.object({
  success: z.literal(true),
  dayId: z.string(),
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
  paidCount: z.number(),
  pendingCount: z.number(),
  paidCents: z.number(),
  pendingCents: z.number(),
  books: z.array(z.object({
    classId: z.string(),
    amountCents: z.number(),
    readingTimeMs: z.number(),
    ttsTimeMs: z.number(),
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
