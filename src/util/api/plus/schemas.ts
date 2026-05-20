import { z } from 'zod';
import { SUPPORTED_CHECKOUT_UI_MODES } from '../../../constant';
import {
  BookGiftInfoBodySchema,
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
