import { z } from 'zod';
import { storedLocales } from '../../../locales';
import { LIKER_PLUS_TIERS } from '../../../constant';
import type { LikerPlusStore } from '../../../types/user';

export const LIKER_PLUS_SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled'] as const;
// Billing system owning the record; 'shared' is a seat granted by a Civic-tier
// giver (see plus/sharedMember.ts). LikerPlusProvider is derived from this.
export const LIKER_PLUS_PROVIDERS = ['stripe', 'revenuecat', 'shared'] as const;
// Store owning a 'revenuecat' record. Only the two the app ships on; RevenueCat's
// other stores (Amazon, promotional, web billing) map to undefined rather than
// guessing, which the client reads as "unknown" and treats permissively.
export const LIKER_PLUS_STORES = ['app_store', 'play_store'] as const;
// `| undefined` is load-bearing: noUncheckedIndexedAccess is off, so a plain
// Record would type the unmapped-store lookup below as always-present.
export const RC_STORE_TO_LIKER_PLUS_STORE: Record<string, LikerPlusStore | undefined> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
};
const LikerPlusSubscriptionStatusSchema = z.enum(LIKER_PLUS_SUBSCRIPTION_STATUSES);
const LikerPlusProviderSchema = z.enum(LIKER_PLUS_PROVIDERS);
const LikerPlusStoreSchema = z.enum(LIKER_PLUS_STORES);
const LikerPlusTierSchema = z.enum(LIKER_PLUS_TIERS);
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
  fbClickId: z.string().optional(),
  fbp: z.string().optional(),
  fbc: z.string().optional(),
}).passthrough();

// Same shape as a body and as a route param; format is enforced downstream by
// checkUserNameValid, which owns the handle character set.
export const UsersHandleSchema = z.object({
  handle: z.string().min(1),
});

export const UsersHandleAvailabilityResponseSchema = z.object({
  handle: z.string(),
  isAvailable: z.boolean(),
});

export const UsersHandleResponseSchema = z.object({
  user: z.string(),
  handle: z.string(),
  previousHandle: z.string(),
});

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
  // Optional so a response assembled outside formatUserCivicLikerProperies cannot
  // 500 on a missing field.
  handle: z.string().optional(),
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
  handle: z.string().optional(),
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
  likerPlusTier: LikerPlusTierSchema.optional(),
  likerPlusProvider: LikerPlusProviderSchema.optional(),
  likerPlusStore: LikerPlusStoreSchema.optional(),
  likerPlusSubscriptionStatus: LikerPlusSubscriptionStatusSchema.optional(),
  plusAffiliateFrom: z.string().optional(),
  locale: LocaleSchema.optional(),
});

export const UserDataScopedResponseSchema = UserDataMinResponseSchema.extend({
  email: z.string().optional(),
  likerPlusPeriod: z.string().optional(),
  likerPlusTier: LikerPlusTierSchema.optional(),
  likerPlusProvider: LikerPlusProviderSchema.optional(),
  likerPlusStore: LikerPlusStoreSchema.optional(),
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
