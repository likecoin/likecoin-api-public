import { formatUserCivicLikerProperies } from '../users';

export function parseCivicLikerV3Status(stakingAmount, stakingAmountTarget, userDoc) {
  const userData = userDoc.data();
  const { isSubscribedCivicLiker } = formatUserCivicLikerProperies(userDoc);
  if (stakingAmount >= stakingAmountTarget) {
    return isSubscribedCivicLiker && userData.civicLiker.civicLikerVersion === 3
      ? 'active'
      : 'activating';
  }
  return 'inactive';
}

export default parseCivicLikerV3Status;
