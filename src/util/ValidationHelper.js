import bech32 from 'bech32';
import {
  GETTING_STARTED_TASKS,
  DISPLAY_SOCIAL_MEDIA_OPTIONS,
  ONE_DAY_IN_MS,
} from '../constant';

export function checkAddressValid(addr) {
  return addr.length === 42 && addr.substr(0, 2) === '0x';
}

export function checkUserNameValid(user) {
  return user && (/^[a-z0-9-_]+$/.test(user) && user.length >= 7 && user.length <= 20);
}

export function checkCosmosAddressValid(addr, prefix = 'cosmos') {
  if (!addr.startsWith(prefix) && addr.length === 45) {
    return false;
  }
  try {
    bech32.decode(addr);
    return true;
  } catch (err) {
    return false;
  }
}

export function filterUserData(u) {
  const {
    user,
    bonusCooldown,
    displayName,
    email,
    phone,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    referrer,
    isEmailVerified,
    isPhoneVerified,
    isEmailEnabled,
    authCoreUserId,
    intercomToken,
    crispToken,
    read = {},
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    isCivicLikerRenewalPeriod,
    isExpiredCivicLiker,
    civicLikerRenewalPeriodLast,
    isHonorCivicLiker,
    civicLikerSince,
    civicLikerVersion,
    locale,
    creatorPitch,
  } = u;
  return {
    user,
    bonusCooldown: bonusCooldown > Date.now() ? bonusCooldown : undefined,
    displayName,
    email,
    phone,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    referrer: !!referrer,
    isEmailVerified,
    isPhoneVerified,
    isEmailEnabled,
    isAuthCore: !!authCoreUserId,
    intercomToken,
    crispToken,
    read,
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    isCivicLikerRenewalPeriod,
    isExpiredCivicLiker,
    civicLikerRenewalPeriodLast,
    isHonorCivicLiker,
    civicLikerSince,
    civicLikerVersion,
    locale,
    creatorPitch,
  };
}

export function filterUserDataMin(userObject, types = []) {
  const {
    user,
    displayName,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    civicLikerSince,
  } = userObject;
  const output = {
    user,
    displayName,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    isCivicLikerTrial,
    isSubscribedCivicLiker,
    civicLikerSince,
  };
  if (types.includes('payment')) {
    output.paymentRedirectWhiteList = userObject.paymentRedirectWhiteList;
  }
  if (types.includes('creator')) {
    output.creatorPitch = userObject.creatorPitch;
  }
  return output;
}

export function filterUserDataScoped(u, scope = []) {
  const user = filterUserData(u);
  let output = filterUserDataMin(u);
  if (scope.includes('email')) output.email = user.email;
  if (scope.includes('read:civic_liker')) {
    const {
      isSubscribedCivicLiker,
      isCivicLikerTrial,
      isCivicLikerRenewalPeriod,
      isExpiredCivicLiker,
      civicLikerRenewalPeriodLast,
      isHonorCivicLiker,
      civicLikerSince,
      civicLikerVersion,
      locale,
    } = user;
    output = {
      isSubscribedCivicLiker,
      isCivicLikerTrial,
      isCivicLikerRenewalPeriod,
      isExpiredCivicLiker,
      civicLikerRenewalPeriodLast,
      isHonorCivicLiker,
      civicLikerSince,
      civicLikerVersion,
      locale,
      ...output,
    };
  }
  if (scope.includes('read:preferences')) {
    output.creatorPitch = user.creatorPitch;
  }
  return output;
}

export function filterTxData({
  from,
  fromId,
  to,
  toId,
  value,
  amount,
  status,
  type,
  remarks,
  httpReferrer,
  completeTs,
  ts,
  txHash,
}) {
  return {
    from,
    fromId,
    to,
    toId,
    value,
    amount,
    status,
    type,
    remarks,
    httpReferrer,
    completeTs,
    ts,
    txHash,
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
  avatar,
  audience,
  description,
  shortName,
  displayName,
  secret,
  redirectWhiteList,
  scopeWhiteList,
  defaultScopes,
  domain,
  platform,
  isTrusted,
}) {
  return {
    avatar,
    audience,
    description,
    shortName,
    displayName,
    secret,
    redirectWhiteList,
    scopeWhiteList,
    defaultScopes,
    domain,
    platform,
    isTrusted,
  };
}

export function filterAppMeta({
  isEmailVerified,
  isPhoneVerified,
  referrer,
  ts,
  android,
  ios,
}) {
  const isNew = (!ts || (Date.now() - ts < ONE_DAY_IN_MS)) && !referrer;
  return {
    isNew,
    isEmailVerified,
    isPhoneVerified,
    ts,
    android,
    ios,
  };
}

export function filterNotification({
  id,
  LIKE,
  from,
  isRead,
  sourceURL,
  to,
  ts,
  txHash,
  type,
}) {
  return {
    id,
    LIKE,
    from,
    isRead,
    sourceURL,
    to,
    ts,
    txHash,
    type,
  };
}

export function filterBookmarks({
  id,
  url,
  ts,
  isArchived,
}) {
  return {
    id,
    url,
    ts,
    isArchived,
  };
}

export function filterFollow({
  id,
  isFollowed,
  ts,
}) {
  return {
    id,
    isFollowed,
    ts,
  };
}
