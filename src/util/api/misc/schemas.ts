import { z } from 'zod';

// Query schemas use .passthrough() so the validate middleware's req.query
// reassignment does not strip params; fields stay .optional() because the
// handlers already guard them (currency throws UNSUPPORTED_CURRENCY, raw is
// only compared against '1').

export const MiscPriceQuerySchema = z.object({
  currency: z.string().optional(),
}).passthrough();

export const MiscSupplyQuerySchema = z.object({
  raw: z.string().optional(),
}).passthrough();

export const MiscPriceResponseSchema = z.object({
  price: z.number(),
});
