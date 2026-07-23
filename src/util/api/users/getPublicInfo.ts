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
import type {
  UserData,
  UserCivicLikerProperties,
} from '../../../types/user';

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
      currentType,
      since,
      period,
    } = likerPlus;
    // Surface which billing system owns the subscription so the client can
    // route "manage subscription" correctly (Stripe portal vs native store
    // sheet). Legacy Stripe records predate `provider` but carry Stripe's
    // subscriptionId/customerId; gifts carry them too (Stripe-managed). Mirrors
    // isStripeOwnedLikerPlus in plus/revenuecat.ts (inlined to avoid an import
    // cycle — revenuecat.ts already imports from this module).
    if (likerPlus.provider === 'stripe' || likerPlus.subscriptionId || likerPlus.customerId) {
      payload.likerPlusProvider = 'stripe';
    } else if (likerPlus.provider === 'revenuecat') {
      payload.likerPlusProvider = 'revenuecat';
    }
    const now = Date.now();
    const renewalLast = end + SUBSCRIPTION_GRACE_PERIOD;
    if (start <= now && now <= renewalLast) {
      payload.likerPlusSince = since;
      payload.isLikerPlus = true;
      payload.isLikerPlusTrial = currentType === 'trial';
      payload.isSubscribedCivicLiker = true;
      payload.likerPlusPeriod = period;
      // Pre-Civic records have no tier; they are Plus.
      payload.likerPlusTier = likerPlus.tier || 'plus';
      payload.likerPlusSubscriptionStatus = likerPlus.subscriptionStatus || 'active';
    } else if (now > renewalLast) {
      payload.isExpiredLikerPlus = true;
      payload.likerPlusSubscriptionStatus = likerPlus.subscriptionStatus || 'canceled';
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

// Resolves a live (non-deleted) user doc by any wallet type, checksumming EVM
// addresses to match how they are stored. Throws on an unrecognised address.
async function resolveUserDocByWallet(
  walletAddress: string,
): Promise<DocumentSnapshot<UserData> | null> {
  let field: 'evmWallet' | 'likeWallet' | 'cosmosWallet';
  let addr = walletAddress;
  if (checkAddressValid(addr)) {
    field = 'evmWallet';
    addr = checksumAddress(addr as `0x${string}`);
  } else if (checkCosmosAddressValid(addr, 'like')) {
    field = 'likeWallet';
    // Bech32 decoding accepts all-uppercase, but Firestore queries are case-sensitive
    // and addresses are stored lowercase.
    addr = addr.toLowerCase();
  } else if (checkCosmosAddressValid(addr, 'cosmos')) {
    field = 'cosmosWallet';
    addr = addr.toLowerCase();
  } else {
    throw new ValidationError('Invalid address');
  }
  const query = await dbRef.where(field, '==', addr).limit(1).get();
  if (!query.docs.length) return null;
  const userDoc = query.docs[0] as DocumentSnapshot<UserData>;
  return isValidUserDoc(userDoc) ? userDoc : null;
}

export async function getUserWithCivicLikerPropertiesByWallet(
  walletAddress: string,
): Promise<UserCivicLikerProperties | null> {
  const userDoc = await resolveUserDocByWallet(walletAddress);
  if (!userDoc) return null;
  return formatUserCivicLikerProperies(userDoc);
}

// Lean sibling of getUserWithCivicLikerPropertiesByWallet: returns only the
// linked wallets, skipping the Civic Liker / Liker Plus computation. For
// cross-wallet ownership checks.
export async function getUserWalletsByWallet(
  walletAddress: string,
): Promise<Pick<UserData, 'evmWallet' | 'likeWallet' | 'cosmosWallet'> | null> {
  const userDoc = await resolveUserDocByWallet(walletAddress);
  if (!userDoc) return null;
  const { evmWallet, likeWallet, cosmosWallet } = userDoc.data() as UserData;
  return { evmWallet, likeWallet, cosmosWallet };
}

export default getUserWithCivicLikerProperties;
