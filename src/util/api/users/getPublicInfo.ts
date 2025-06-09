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

function isValidUserDoc(userDoc) {
  if (!userDoc || !userDoc.exists) {
    return false;
  }
  const userData = userDoc.data();
  if (userData.isDeleted) {
    return false;
  }
  return true;
}

export function formatUserCivicLikerProperies(userDoc) {
  const { id } = userDoc;
  const data = userDoc.data();
  const { civicLiker, avatarHash, likerPlus } = data;
  const payload = data;
  payload.user = id;
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
    } = likerPlus;
    const now = Date.now();
    const renewalLast = end + SUBSCRIPTION_GRACE_PERIOD;
    if (start <= now && now <= renewalLast) {
      payload.likerPlusSince = since;
      payload.isLikerPlus = true;
      payload.isSubscribedCivicLiker = true;
    }
  }

  return payload;
}

export async function getUserWithCivicLikerProperties(id) {
  const userDoc = await dbRef.doc(id).get();
  if (!isValidUserDoc(userDoc)) return null;
  const payload = formatUserCivicLikerProperies(userDoc);
  return payload;
}

export async function getUserAvatar(id) {
  const userDoc = await dbRef.doc(id).get();
  if (!isValidUserDoc(userDoc)) return null;
  const data = userDoc.data();
  const { avatar } = data;
  return avatar || AVATAR_DEFAULT_PATH;
}

export async function getUserWithCivicLikerPropertiesByWallet(addr) {
  let field;
  if (checkAddressValid(addr)) {
    field = 'evmWallet';
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
  const payload = formatUserCivicLikerProperies(userDoc);
  return payload;
}

export default getUserWithCivicLikerProperties;
