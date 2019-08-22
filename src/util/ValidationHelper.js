import {
  GETTING_STARTED_TASKS,
  DISPLAY_SOCIAL_MEDIA_OPTIONS,
} from '../constant';

export function checkAddressValid(addr) {
  return addr.length === 42 && addr.substr(0, 2) === '0x';
}

export function checkUserNameValid(user) {
  return user && (/^[a-z0-9-_]+$/.test(user) && user.length >= 7 && user.length <= 20);
}

export function filterUserData(u) {
  const {
    user,
    bonusCooldown,
    displayName,
    email,
    avatar,
    wallet,
    referrer,
    isEmailVerified,
    isEmailEnabled,
    intercomToken,
    read = {},
    isPreRegCivicLiker,
    preRegCivicLikerStatus,
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    isCivicLikerRenewalPeriod,
    isExpiredCivicLiker,
    civicLikerRenewalPeriodLast,
    isHonorCivicLiker,
    civicLikerSince,
    civicLikerStatus,
    locale,
  } = u;
  return {
    user,
    bonusCooldown: bonusCooldown > Date.now() ? bonusCooldown : undefined,
    displayName,
    email,
    avatar,
    wallet,
    referrer: !!referrer,
    isEmailVerified,
    isEmailEnabled,
    intercomToken,
    read,
    isPreRegCivicLiker,
    preRegCivicLikerStatus,
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    isCivicLikerRenewalPeriod,
    isExpiredCivicLiker,
    civicLikerRenewalPeriodLast,
    isHonorCivicLiker,
    civicLikerSince,
    civicLikerStatus,
    locale,
  };
}

export function filterUserDataMin({
  user,
  displayName,
  avatar,
  wallet,
  isPreRegCivicLiker,
  preRegCivicLikerStatus,
  isSubscribedCivicLiker,
  isCivicLikerTrial,
  civicLikerSince,
}) {
  return {
    user,
    displayName,
    avatar,
    wallet,
    isPreRegCivicLiker,
    preRegCivicLikerStatus,
    isCivicLikerTrial,
    isSubscribedCivicLiker,
    civicLikerSince,
  };
}

export function filterUserDataScoped(u, scope = []) {
  const user = filterUserData(u);
  let output = filterUserDataMin(u);
  if (scope.includes('email')) output.email = user.email;
  if (scope.includes('read:civic_liker')) {
    const {
      isPreRegCivicLiker,
      preRegCivicLikerStatus,
      isSubscribedCivicLiker,
      isCivicLikerTrial,
      isCivicLikerRenewalPeriod,
      isExpiredCivicLiker,
      civicLikerRenewalPeriodLast,
      isHonorCivicLiker,
      civicLikerSince,
      civicLikerStatus,
      locale,
    } = user;
    output = {
      isPreRegCivicLiker,
      preRegCivicLikerStatus,
      isSubscribedCivicLiker,
      isCivicLikerTrial,
      isCivicLikerRenewalPeriod,
      isExpiredCivicLiker,
      civicLikerRenewalPeriodLast,
      isHonorCivicLiker,
      civicLikerSince,
      civicLikerStatus,
      locale,
      ...output,
    };
  }
  return output;
}

export function filterTxData({
  from,
  fromId,
  to,
  toId,
  value,
  status,
  type,
  remarks,
  httpReferrer,
  completeTs,
  ts,
}) {
  return {
    from,
    fromId,
    to,
    toId,
    value,
    status,
    type,
    remarks,
    httpReferrer,
    completeTs,
    ts,
  };
}

export function filterMissionData(m) {
  const {
    id,
    reward,
    refereeReward,
    refereeExtraReward,
    referralReward,
    referralPayoutType,
    targetPayoutType,
    done,
    seen,
    status,
    bonusId,
    isProxy,
    upcoming,
    endTs,
    isDesktopOnly,
    isMobileOnly,
    hide,
    staying,
  } = m;
  const misc = {};
  GETTING_STARTED_TASKS.forEach((task) => {
    if (m[task]) misc[task] = m[task];
  });
  const isHidable = m.isHidable || (m.isHidableAfterDone && m.done);
  return {
    id,
    reward,
    refereeReward,
    refereeExtraReward,
    referralReward,
    referralPayoutType,
    targetPayoutType,
    done,
    seen,
    status,
    isProxy,
    isClaimed: !!bonusId,
    upcoming,
    endTs,
    isDesktopOnly,
    isMobileOnly,
    isHidable,
    hide,
    staying,
    ...misc,
  };
}

export function filterPayoutData({
  id,
  type,
  referrer,
  referee,
  waitForClaim,
  value,
}) {
  return {
    id,
    type,
    referrer,
    referee,
    waitForClaim,
    value,
  };
}

export function filterSocialPlatformPersonal({
  userId,
  pages,
  displayName,
  url,
  isPublic,
}) {
  const data = {
    displayName,
    id: userId,
    isPublic: isPublic !== false,
    url,
  };
  if (pages) data.pages = pages;
  return data;
}

export function filterSocialLinksPersonal({
  iconType,
  isPublic = true,
  order,
  siteDisplayName,
  url,
}) {
  return {
    iconType,
    isPublic,
    order,
    siteDisplayName,
    url,
  };
}

export function filterSocialPlatformPublic({
  displayName,
  iconType,
  isExternalLink,
  order,
  siteDisplayName,
  url,
}) {
  return {
    displayName,
    iconType,
    isExternalLink,
    order,
    siteDisplayName,
    url,
  };
}

export function filterSocialLinksMeta({
  displaySocialMediaOption = DISPLAY_SOCIAL_MEDIA_OPTIONS[0],
}) {
  return {
    displaySocialMediaOption,
  };
}

export function filterOAuthClientInfo({
  audience,
  description,
  shortName,
  displayName,
  secret,
  redirectWhiteList,
  scopeWhiteList,
  domain,
  platform,
  isTrusted,
}) {
  return {
    audience,
    description,
    shortName,
    displayName,
    secret,
    redirectWhiteList,
    scopeWhiteList,
    domain,
    platform,
    isTrusted,
  };
}
