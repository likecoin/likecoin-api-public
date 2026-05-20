import { z } from 'zod';

export const UsersNewCheckBodySchema = z.object({
  user: z.string().optional(),
  email: z.string().email().optional(),
  evmWallet: z.string().optional(),
  magicDIDToken: z.string().optional(),
});

export const UsersPreferencesBodySchema = z.object({
  locale: z.string().nullish(),
  creatorPitch: z.string().optional(),
  paymentRedirectWhiteList: z.array(z.string()).nullish(),
});

const SignaturePayloadSchema = z.object({
  signature: z.string().min(1),
  publicKey: z.string().optional(),
  message: z.string().min(1),
});

export const UsersDeleteBodySchema = z.object({
  authCoreAccessToken: z.string().optional(),
  signature: SignaturePayloadSchema,
  signMethod: z.string().optional(),
});

export const UsersUpdateBodySchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  isEmailEnabled: z.union([z.boolean(), z.string()]).optional(),
});

export const UsersUpdateAvatarBodySchema = z.object({
  avatarSHA256: z.string().optional(),
});

export const UserDataMinResponseSchema = z.object({
  user: z.string(),
  displayName: z.string().optional(),
  avatar: z.string().optional(),
  wallet: z.string().optional(),
  cosmosWallet: z.string().optional(),
  likeWallet: z.string().optional(),
  evmWallet: z.string().optional(),
  isSubscribedCivicLiker: z.boolean().optional(),
  isCivicLikerTrial: z.boolean().optional(),
  civicLikerSince: z.number().optional(),
  likerPlusSince: z.number().optional(),
  isLikerPlus: z.boolean().optional(),
  isLikerPlusTrial: z.boolean().optional(),
  isExpiredLikerPlus: z.boolean().optional(),
  description: z.string().optional(),
  paymentRedirectWhiteList: z.array(z.string()).optional(),
  creatorPitch: z.string().optional(),
});
