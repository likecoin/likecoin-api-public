import { z } from 'zod';

// eslint-disable-next-line import/prefer-default-export
export const WalletAuthorizeBodySchema = z.object({
  wallet: z.string().optional(),
  from: z.string().optional(),
  signature: z.string().min(1),
  publicKey: z.string().optional(),
  message: z.string().min(1),
  signMethod: z.string().optional(),
  expiresIn: z.enum(['1h', '1d', '7d', '30d']).optional(),
}).refine(
  (b) => !!(b.wallet || b.from),
  { message: 'wallet or from is required', path: ['wallet'] },
);
