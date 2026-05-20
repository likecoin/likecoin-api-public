import type { z } from 'zod';
import type { UserCivicLikerProperties, LikerPlusSubscriptionStatus } from './user';
import type { SupportedLocale } from '../locales';
import type { AppMeta } from './firestore';
import type { UserDataMinResponseSchema } from '../util/api/users/schemas';

// User-related filtered/validated interfaces
// These are transformed versions of the raw data, used for API responses and validation

export interface UserDataFiltered extends Omit<UserCivicLikerProperties, 'referrer' | 'authCoreUserId' | 'read'> {
  referrer: boolean;
  isAuthCore: boolean;
  read: Record<string, any>;
}

export type UserDataMin = z.infer<typeof UserDataMinResponseSchema>;

export interface UserDataScopedFiltered extends UserDataMin {
  likerPlusPeriod?: any;
  likerPlusSubscriptionStatus?: LikerPlusSubscriptionStatus;
  plusAffiliateFrom?: string;
  email?: string;
  isExpiredCivicLiker?: boolean;
  isCivicLikerRenewalPeriod?: boolean;
  civicLikerRenewalPeriodLast?: number;
  isHonorCivicLiker?: boolean;
  civicLikerVersion?: number;
  locale?: SupportedLocale;
}

export interface AppMetaFiltered extends Omit<AppMeta, 'referrer'> {
  isNew: boolean;
}
