import { checksumAddress } from 'viem';
import type { DocumentSnapshot } from '@google-cloud/firestore';

import {
  API_EXTERNAL_HOSTNAME,
  AVATAR_DEFAULT_PATH,
  CIVIC_LIKER_START_DATE,
  SUBSCRIPTION_GRACE_PERIOD,
  DEFAULT_AVATAR_SIZE,
} from '../../../constant';
import { ValidationError } from '../../ValidationError';
import {
  checkAddressValid,
  checkCosmosAddressValid,
} from '../../ValidationHelper';
import {
  userCollection as dbRef,
} from '../../firebase';

interface CivicLikerData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  since: number;
  currentType?: string;
  civicLikerVersion?: number;
}

interface LikerPlusData {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  since: number;
  period?: string;
  subscriptionId?: string;
  customerId?: string;
}

export interface UserData {
  // Identity fields
  isDeleted?: boolean;
  displayName?: string;
  description?: string;

  // Avatar fields
  avatar?: string;
  avatarHash?: string;

  // Email fields
  email?: string;
  isEmailVerified?: boolean;
  isEmailEnabled?: boolean;
  normalizedEmail?: string;
  isEmailInvalid?: boolean;
  isEmailBlacklisted?: boolean;
  isEmailDuplicated?: boolean;
  lastVerifyTs?: number;
  verificationUUID?: string;

  // Phone fields
  phone?: string;
  isPhoneVerified?: boolean;

  // Wallet fields
  likeWallet?: string;
  cosmosWallet?: string;
  evmWallet?: string;

  // Auth provider fields
  authCoreUserId?: string;
  magicUserId?: string;

  // Platform fields
  delegatedPlatform?: string;
  isPlatformDelegated?: boolean;
  mediaChannels?: string[];

  // Subscription fields
  civicLiker?: CivicLikerData;
  likerPlus?: LikerPlusData;

  // Metadata fields
  locale?: string;
  timestamp?: number;
  bonusCooldown?: number;
  referrer?: string;
  isLocked?: boolean;
  pendingLIKE?: Record<string, number>;
  isPendingLIKE?: boolean;

  // Allow additional fields
  [key: string]: any;
}

export interface UserCivicLikerProperties extends UserData {
  user: string;
  avatar: string;
  isCivicLikerRenewalPeriod?: boolean;
  civicLikerSince?: number;
  civicLikerRenewalPeriodLast?: number;
  isHonorCivicLiker?: boolean;
  civicLikerVersion?: number;
  isCivicLikerTrial?: boolean;
  isSubscribedCivicLiker?: boolean;
  isExpiredCivicLiker?: boolean;
  likerPlusSince?: number;
  isLikerPlus?: boolean;
  likerPlusPeriod?: string;
}

function isValidUserDoc(userDoc: DocumentSnapshot<UserData> | undefined): boolean {
  if (!userDoc || !userDoc.exists) {
    return false;
  }
  const userData = userDoc.data();
  if (userData?.isDeleted) {
    return false;
  }
  return true;
}

export function formatUserCivicLikerProperies(
  userDoc: DocumentSnapshot<UserData>,
): UserCivicLikerProperties {
  const { id } = userDoc;
  const data = userDoc.data() as UserData;
  const { civicLiker, avatarHash, likerPlus } = data;
  const payload: UserCivicLikerProperties = {
    ...data,
    user: id,
    avatar: '',
  };
  let avatarUrl = `https://${API_EXTERNAL_HOSTNAME}/users/id/${id}/avatar?size=${DEFAULT_AVATAR_SIZE}`;
  if (avatarHash) avatarUrl += `&hash=${avatarHash}`;
  payload.avatar = avatarUrl;

  if (civicLiker) {
    const {
      currentPeriodStart: start,
      currentPeriodEnd: end,
      since,
      currentType,
      civicLikerVersion,
    } = civicLiker;
    const now = Date.now();
    const renewalLast = end + SUBSCRIPTION_GRACE_PERIOD;
    if (start <= now && now <= renewalLast) {
      payload.isCivicLikerRenewalPeriod = end <= now && now <= renewalLast;
      payload.civicLikerSince = since;
      payload.civicLikerRenewalPeriodLast = renewalLast;
      payload.isHonorCivicLiker = since === CIVIC_LIKER_START_DATE;
      payload.civicLikerVersion = civicLikerVersion;
      if (currentType === 'trial') {
        payload.isCivicLikerTrial = true;
      } else {
        payload.isSubscribedCivicLiker = true;
      }
    } else if (now > renewalLast) {
      payload.isExpiredCivicLiker = true;
    }
  }

  if (likerPlus) {
    const {
      currentPeriodStart: start,
      currentPeriodEnd: end,
      since,
      period,
    } = likerPlus;
    const now = Date.now();
    const renewalLast = end + SUBSCRIPTION_GRACE_PERIOD;
    if (start <= now && now <= renewalLast) {
      payload.likerPlusSince = since;
      payload.isLikerPlus = true;
      payload.isSubscribedCivicLiker = true;
      payload.likerPlusPeriod = period;
    }
  }

  return payload;
}

export async function getUserWithCivicLikerProperties(
  id: string,
): Promise<UserCivicLikerProperties | null> {
  const userDoc = await dbRef.doc(id).get();
  if (!isValidUserDoc(userDoc)) return null;
  const payload = formatUserCivicLikerProperies(userDoc as DocumentSnapshot<UserData>);
  return payload;
}

export async function getUserAvatar(id: string): Promise<string | null> {
  const userDoc = await dbRef.doc(id).get();
  if (!isValidUserDoc(userDoc as DocumentSnapshot<UserData>)) return null;
  const data: UserData | undefined = userDoc.data();
  if (!data) return AVATAR_DEFAULT_PATH;
  const { avatar } = data;
  return avatar || AVATAR_DEFAULT_PATH;
}

export async function getUserWithCivicLikerPropertiesByWallet(
  walletAddress: string,
): Promise<UserCivicLikerProperties | null> {
  let field: 'evmWallet' | 'likeWallet' | 'cosmosWallet';
  let addr = walletAddress;
  if (checkAddressValid(addr)) {
    field = 'evmWallet';
    addr = checksumAddress(addr as `0x${string}`);
  } else if (checkCosmosAddressValid(addr, 'like')) {
    field = 'likeWallet';
  } else if (checkCosmosAddressValid(addr, 'cosmos')) {
    field = 'cosmosWallet';
  } else {
    throw new ValidationError('Invalid address');
  }
  const query = await dbRef.where(field, '==', addr).limit(1).get();
  if (!query.docs.length) return null;
  const userDoc = query.docs[0];
  if (!isValidUserDoc(userDoc)) return null;
  const payload = formatUserCivicLikerProperies(userDoc as DocumentSnapshot<UserData>);
  return payload;
}

export default getUserWithCivicLikerProperties;
