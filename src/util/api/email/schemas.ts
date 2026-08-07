import { z } from 'zod';

export const EmailVerifyUserParamsSchema = z.object({
  id: z.string().min(1),
});

// The handler reads nothing off the body; .passthrough() keeps it intact.
export const EmailVerifyUserBodySchema = z.object({}).passthrough();

export const EmailVerifyParamsSchema = z.object({
  uuid: z.string().min(1),
});

export const EmailVerifyResponseSchema = z.object({
  referrer: z.boolean(),
  wallet: z.string().optional(),
});
