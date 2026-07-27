// Firestore collection document types
// These represent the raw data structures stored in Firestore collections

import type { UserCivicLikerProperties } from './user';
import type { NFTBookUserData } from './book';

export interface ConfigData {
  key: string;
  value: any;
  ts?: number;
  [key: string]: any;
}

export interface OAuthClientInfo {
  avatar?: string;
  audience?: string;
  description?: string;
  shortName?: string;
  displayName?: string;
  secret?: string;
  redirectWhiteList?: string[];
  scopeWhiteList?: string[];
  defaultScopes?: string[];
  domain?: string;
  platform?: string;
  isTrusted?: boolean;
}

export interface BookUserInfoResult {
  wallet: string;
  bookUserInfo: NFTBookUserData | null;
  likerUserInfo: UserCivicLikerProperties | null;
}
