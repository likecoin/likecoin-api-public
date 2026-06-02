import { z } from 'zod';

export const EmailVerifyUserParamsSchema = z.object({
  id: z.string().min(1),
});

// Only `ref` is read by the handler; .passthrough() keeps body intact.
export const EmailVerifyUserBodySchema = z.object({
  ref: z.string().optional(),
}).passthrough();

export const EmailVerifyParamsSchema = z.object({
  uuid: z.string().min(1),
});

export const EmailVerifyResponseSchema = z.object({
  referrer: z.boolean(),
  wallet: z.string().optional(),
});
