import {
  AVATAR_DEFAULT_PATH,
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
      currentPeriodStart,
      currentPeriodEnd,
      since,
      currentType,
    } = subscriptionDoc.data();
    const now = Date.now();
    if (currentType !== 'trial' && now >= currentPeriodStart && now <= currentPeriodEnd + SUBSCRIPTION_GRACE_PERIOD) {
      payload.isSubscribedCivicLiker = true;
      payload.civicLikerSince = since;
    }
  }

  return payload;
}

export default getUserWithCivicLikerProperties;
