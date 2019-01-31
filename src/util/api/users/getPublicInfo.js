import {
  AVATAR_DEFAULT_PATH,
  CIVIC_LIKER_START_DATE,
  SUBSCRIPTION_GRACE_PERIOD,
} from '../../../constant';
import {
  userCollection as dbRef,
  subscriptionUserCollection as subscriptionDbRef,
} from '../../firebase';

export async function getUserWithCivicLikerProperties(id) {
  const [userDoc, subscriptionDoc] = await Promise.all([
    dbRef.doc(id).get(),
    subscriptionDbRef.doc(id).get(),
  ]);
  if (!userDoc.exists) return null;

  const payload = userDoc.data();
  payload.user = id;
  if (!payload.avatar) {
    payload.avatar = AVATAR_DEFAULT_PATH;
  }

  if (subscriptionDoc.exists) {
    const {
      currentPeriodStart: start,
      currentPeriodEnd: end,
      since,
      currentType,
    } = subscriptionDoc.data();
    const now = Date.now();
    const renewalLast = end + SUBSCRIPTION_GRACE_PERIOD;
    if (start <= now && now <= renewalLast) {
      payload.isCivicLikerRenewalPeriod = end <= now && now <= renewalLast;
      payload.civicLikerSince = since;
      payload.civicLikerRenewalPeriodLast = renewalLast;
      payload.isHonorCivicLiker = since === CIVIC_LIKER_START_DATE;
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

export default getUserWithCivicLikerProperties;
