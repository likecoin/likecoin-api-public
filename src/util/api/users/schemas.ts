import { z } from 'zod';

export const UsersNewCheckBodySchema = z.object({
  user: z.string().optional(),
  email: z.string().email().optional(),
  evmWallet: z.string().optional(),
  magicDIDToken: z.string().optional(),
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
