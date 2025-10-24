import type { UserCivicLikerProperties } from './user';

// User-related filtered/validated interfaces
// These are transformed versions of the raw data, used for API responses and validation

export interface UserDataFiltered extends Omit<UserCivicLikerProperties, 'referrer' | 'authCoreUserId' | 'read'> {
  referrer: boolean;
  isAuthCore: boolean;
  read: Record<string, any>;
}

export interface UserDataMin extends Pick<UserCivicLikerProperties,
  'user' | 'displayName' | 'avatar' | 'cosmosWallet' |
  'likeWallet' | 'evmWallet' | 'isSubscribedCivicLiker' |
  'isCivicLikerTrial' | 'civicLikerSince' | 'likerPlusSince' |
  'isLikerPlus' | 'isLikerPlusTrial' | 'description'> {
  wallet?: string;
  paymentRedirectWhiteList?: string[];
  creatorPitch?: string;
}

export interface UserDataScopedFiltered extends UserDataMin {
  likerPlusPeriod?: any;
  email?: string;
  isExpiredCivicLiker?: boolean;
  isCivicLikerRenewalPeriod?: boolean;
  civicLikerRenewalPeriodLast?: number;
  isHonorCivicLiker?: boolean;
  civicLikerVersion?: number;
  locale?: string;
}

export interface AppMetaFiltered extends Omit<import('./firestore').AppMeta, 'referrer'> {
  isNew: boolean;
}
