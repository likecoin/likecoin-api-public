import { z } from 'zod';
import { UserDataMinResponseSchema } from '../users/schemas';

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

// snake_case body fields kept .optional() + .passthrough(): the handlers throw
// their own INVALID_PAYLOAD when a field is missing.
export const WalletEvmMigrateBookBodySchema = z.object({
  like_class_id: z.string().optional(),
  evm_class_id: z.string().optional(),
}).passthrough();

export const WalletEvmMigrateBodySchema = z.object({
  cosmos_address: z.string().optional(),
  cosmos_signature: z.string().optional(),
  cosmos_public_key: z.string().optional(),
  cosmos_signature_content: z.string().optional(),
  signMethod: z.string().optional(),
}).passthrough();

export const WalletLikeWalletParamsSchema = z.object({
  likeWallet: z.string().min(1),
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
  // The liker.land step no longer runs: the three LikerLand fields below are
  // frozen at false/null/null, kept so existing clients keep parsing.
  // Nullable fields here are always null, never undefined.
  isMigratedLikerLand: z.boolean(),
  migratedLikerId: z.string().nullable(),
  migratedLikerLandUser: z.preprocess(
    (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null),
    z.object({
      id: z.string().nullish(),
      likeWallet: z.string().nullish(),
      lastLoginMethod: z.string().nullish(),
      registerLoginMethod: z.string().nullish(),
    }).nullable(),
  ),
  migrateBookUserError: z.string().nullable(),
  migrateBookOwnerError: z.string().nullable(),
  migrateLikerIdError: z.string().nullable(),
  migrateLikerLandError: z.unknown().nullable(),
});

// Both migration paths (likeWallet and legacy v1) must return this exact shape;
// the route forwards it straight to sendValidatedJSON.
export type WalletEvmMigrateResult = z.infer<typeof WalletEvmMigrateResponseSchema>;

export const WalletEvmMigrateBookResponseSchema = z.object({
  migratedClassIds: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});

// Unauthenticated endpoint: likerIdInfo is the public-safe filterUserDataMin set
// (or null when no user); evmWallet may be null/undefined when unmigrated.
export const WalletEvmMigrateUserResponseSchema = z.object({
  likerIdInfo: UserDataMinResponseSchema.nullable(),
  evmWallet: z.string().nullable().optional(),
});
