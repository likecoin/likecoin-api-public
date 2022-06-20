import {
  AVATAR_DEFAULT_PATH,
  CIVIC_LIKER_START_DATE,
  SUBSCRIPTION_GRACE_PERIOD,
} from '../../../constant';
import {
  userCollection as dbRef,
} from '../../firebase';

export function formatUserCivicLikerProperies(id, data) {
  const { avatar, civicLiker } = data;
  const payload = data;
  payload.user = id;
  if (!avatar) {
    payload.avatar = AVATAR_DEFAULT_PATH;
  }

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
  const [userDoc] = await Promise.all([
    dbRef.doc(id).get(),
  ]);
  if (!userDoc.exists) return null;

  const data = userDoc.data();
  const payload = formatUserCivicLikerProperies(id, data);
  return payload;
}

export default getUserWithCivicLikerProperties;
