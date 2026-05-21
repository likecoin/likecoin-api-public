import { z } from 'zod';
import { SUPPORTED_CHECKOUT_UI_MODES } from '../../../constant';
import {
  BookGiftInfoBodySchema,
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
