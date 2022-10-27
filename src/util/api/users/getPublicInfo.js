import {
  API_EXTERNAL_HOSTNAME,
  AVATAR_DEFAULT_PATH,
  CIVIC_LIKER_START_DATE,
  SUBSCRIPTION_GRACE_PERIOD,
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

function formatUserCivicLikerProperies(userDoc) {
  const { id } = userDoc;
  const data = userDoc.data();
  const { civicLiker } = data;
  const payload = data;
  payload.user = id;
  payload.avatar = `https://${API_EXTERNAL_HOSTNAME}/users/id/${id}/avatar`;

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
    field = 'wallet';
  } else if (checkCosmosAddressValid(addr, 'like')) {
    field = 'likeWallet';
  } else if (checkCosmosAddressValid(addr, 'cosmos')) {
    field = 'cosmosWallet';
  } else {
    throw new ValidationError('Invalid address');
  }
  const query = await dbRef.where(field, '==', addr).limit(1).get();
  if (query.docs.length < 0) return null;
  const userDoc = query.docs[0];
  if (!isValidUserDoc(userDoc)) return null;
  const payload = formatUserCivicLikerProperies(userDoc);
  return payload;
}

export default getUserWithCivicLikerProperties;
