import { z } from 'zod';
import { SUPPORTED_CHECKOUT_UI_MODES } from '../../../constant';
import {
  BookGiftInfoBodySchema,
  BookGiftInfoSchema,
  StripeCheckoutResponseSchema,
  TrackingFieldsSchema,
} from '../likernft/book/schemas';

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
// server-to-server by liker-land-v3. Durations are already paced (anti-fraud)
// upstream; cap each at 4h — the reader's per-session ceiling — as a sanity bound.
const MAX_USAGE_DELTA_MS = 4 * 60 * 60 * 1000;
const UsageDurationSchema = z.number().int().min(0).max(MAX_USAGE_DELTA_MS);

export const PlusReadingUsageBodySchema = z.object({
  readerWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'INVALID_READER_WALLET'),
  classId: z.string().min(1),
  readingTimeMs: UsageDurationSchema,
  ttsTimeMs: UsageDurationSchema,
  occurredAt: z.number().int().positive().optional(),
});

export const PlusReadingUsageResponseSchema = z.object({
  success: z.literal(true),
  periodId: z.string(),
});
