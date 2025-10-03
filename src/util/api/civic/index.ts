import type { DocumentSnapshot } from '@google-cloud/firestore';
import { formatUserCivicLikerProperies, UserData } from '../users';

export function parseCivicLikerV3Status(
  stakingAmount: number,
  stakingAmountTarget: number,
  userDoc: DocumentSnapshot<UserData>,
): 'active' | 'activating' | 'inactive' {
  const userData = userDoc.data();
  const { isSubscribedCivicLiker } = formatUserCivicLikerProperies(userDoc);
  if (stakingAmount >= stakingAmountTarget) {
    return isSubscribedCivicLiker && userData?.civicLiker?.civicLikerVersion === 3
      ? 'active'
      : 'activating';
  }
  return 'inactive';
}

export default parseCivicLikerV3Status;
