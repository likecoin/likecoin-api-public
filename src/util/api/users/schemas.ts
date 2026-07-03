import { z } from 'zod';
import { storedLocales } from '../../../locales';

export const LIKER_PLUS_SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled'] as const;
const LikerPlusSubscriptionStatusSchema = z.enum(LIKER_PLUS_SUBSCRIPTION_STATUSES);
// Response locale reflects stored data, which includes legacy codes (e.g. 'cn').
// Input locale is guarded against supportedLocales separately.
const LocaleSchema = z.enum(storedLocales);

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
  magicDIDToken: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  isEmailEnabled: z.union([z.boolean(), z.string()]).optional(),
});

export const UsersEmailCheckBodySchema = z.object({
  email: z.string().email(),
});

export const UsersUpdateAvatarBodySchema = z.object({
  avatarSHA256: z.string().optional(),
});

export const UsersIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const UsersAddrParamsSchema = z.object({
  addr: z.string().min(1),
});

// /new reads many platform-specific body fields and forwards the whole body
// (`payload = req.body`); .passthrough() is required so nothing is stripped.
export const UsersRegisterBodySchema = z.object({
  platform: z.string().optional(),
  appReferrer: z.string().optional(),
  user: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  email: z.string().optional(),
  sourceURL: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
}).passthrough();

export const UsersLoginBodySchema = z.object({
  platform: z.string().optional(),
  appReferrer: z.string().optional(),
  sourceURL: z.string().optional(),
  utmSource: z.string().optional(),
}).passthrough();

export const UsersPreferencesResponseSchema = z.object({
  locale: z.string().optional(),
  creatorPitch: z.string(),
  paymentRedirectWhiteList: z.array(z.string()),
});

export const UsersUpdateAvatarResponseSchema = z.object({
  avatar: z.string().url(),
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

export const UserDataFilteredResponseSchema = z.object({
  user: z.string(),
  bonusCooldown: z.number().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  email: z.string().optional(),
  avatar: z.string().optional(),
  wallet: z.string().optional(),
  cosmosWallet: z.string().optional(),
  likeWallet: z.string().optional(),
  evmWallet: z.string().optional(),
  referrer: z.boolean(),
  isEmailVerified: z.boolean().optional(),
  isEmailEnabled: z.boolean().optional(),
  isAuthCore: z.boolean(),
  read: z.record(z.string(), z.unknown()),
  isSubscribedCivicLiker: z.boolean().optional(),
  isCivicLikerTrial: z.boolean().optional(),
  isCivicLikerRenewalPeriod: z.boolean().optional(),
  isExpiredCivicLiker: z.boolean().optional(),
  civicLikerRenewalPeriodLast: z.number().optional(),
  isHonorCivicLiker: z.boolean().optional(),
  civicLikerSince: z.number().optional(),
  civicLikerVersion: z.number().optional(),
  likerPlusSince: z.number().optional(),
  isLikerPlus: z.boolean().optional(),
  isLikerPlusTrial: z.boolean().optional(),
  isExpiredLikerPlus: z.boolean().optional(),
  likerPlusPeriod: z.string().optional(),
  likerPlusProvider: z.enum(['stripe', 'revenuecat']).optional(),
  likerPlusSubscriptionStatus: LikerPlusSubscriptionStatusSchema.optional(),
  plusAffiliateFrom: z.string().optional(),
  locale: LocaleSchema.optional(),
});

export const UserDataScopedResponseSchema = UserDataMinResponseSchema.extend({
  email: z.string().optional(),
  likerPlusPeriod: z.string().optional(),
  likerPlusProvider: z.enum(['stripe', 'revenuecat']).optional(),
  likerPlusSubscriptionStatus: LikerPlusSubscriptionStatusSchema.optional(),
  plusAffiliateFrom: z.string().optional(),
  isCivicLikerRenewalPeriod: z.boolean().optional(),
  isExpiredCivicLiker: z.boolean().optional(),
  civicLikerRenewalPeriodLast: z.number().optional(),
  isHonorCivicLiker: z.boolean().optional(),
  civicLikerVersion: z.number().optional(),
  locale: LocaleSchema.optional(),
});

export const UserProfileResponseSchema = UserDataScopedResponseSchema.extend({
  // createIntercomTokenForUser returns undefined when Intercom is unconfigured.
  intercomToken: z.string().optional(),
});
