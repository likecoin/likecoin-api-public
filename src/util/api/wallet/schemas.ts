import { z } from 'zod';

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

export const WalletEvmMigrateEmailMagicBodySchema = z.object({
  wallet: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1),
});

export const WalletAuthorizeResponseSchema = z.object({
  jwtid: z.string(),
  token: z.string(),
  intercomToken: z.string().optional(),
});

export const WalletEvmMigrateResponseSchema = z.object({
  isMigratedBookUser: z.boolean(),
  isMigratedBookOwner: z.boolean(),
  isMigratedLikerId: z.boolean(),
  isMigratedLikerLand: z.boolean(),
  migratedLikerId: z.string().optional(),
  migratedLikerLandUser: z.string().optional(),
  migrateBookUserError: z.string().optional(),
  migrateBookOwnerError: z.string().optional(),
  migrateLikerIdError: z.string().optional(),
  migrateLikerLandError: z.string().optional(),
});
