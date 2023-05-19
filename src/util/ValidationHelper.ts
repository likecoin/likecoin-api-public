import bech32 from 'bech32';
import {
  GETTING_STARTED_TASKS,
  DISPLAY_SOCIAL_MEDIA_OPTIONS,
  ONE_DAY_IN_MS,
  MIN_USER_ID_LENGTH,
  MAX_USER_ID_LENGTH,
} from '../constant';

export function checkAddressValid(addr) {
  return addr.length === 42 && addr.substr(0, 2) === '0x';
}

export function checkUserNameValid(user) {
  return user && (/^[a-z0-9-_]+$/.test(user) && user.length >= MIN_USER_ID_LENGTH && user.length <= MAX_USER_ID_LENGTH);
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
    description,
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
    description,
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

export function filterUserDataMin(userObject, types: string[] = []) {
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
    description,
  } = userObject;
  const output: any = {
    user,
    displayName,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    isCivicLikerTrial,
    isSubscribedCivicLiker,
    civicLikerSince,
    description,
  };
  if (types.includes('payment')) {
    output.paymentRedirectWhiteList = userObject.paymentRedirectWhiteList;
  }
  if (types.includes('creator')) {
    output.creatorPitch = userObject.creatorPitch;
  }
  return output;
}

export function filterUserDataScoped(u, scope: string[] = []) {
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
  const data: any = {
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

export function filterLikeNFTISCNData({
  iscnId,
  classId,
  nextNewNFTId,
  totalCount,
  currentPrice,
  basePrice,
  soldCount,
  classUri,
  creatorWallet,
  ownerWallet,
}) {
  return {
    iscnId,
    classId,
    nextNewNFTId,
    totalCount,
    currentPrice,
    basePrice,
    soldCount,
    classUri,
    creatorWallet,
    ownerWallet,
  };
}

export function filterLikeNFTMetadata({
  image,
  externalUrl,
  description,
  name,
  backgroundColor,
  animationUrl,
  youtubeUrl,
  iscnOwner,
  iscnStakeholders,
  iscnId,
  iscnRecordTimestamp,
  ...data
}) {
  // key with underscore as in https://docs.opensea.io/docs/metadata-standards
  return {

    ...data,
    image,
    external_url: externalUrl,
    description,
    name,
    background_color: backgroundColor,
    animation_url: animationUrl,
    youtube_url: youtubeUrl,
    iscn_id: iscnId,
    iscn_owner: iscnOwner,
    iscn_record_timestamp: iscnRecordTimestamp,
    iscn_stakeholders: iscnStakeholders,

  };
}

export function filterLikeNFTFiatData({
  status,
  sessionId,
  isPendingClaim,
  errorMessage,
  wallet,
  classId,
  iscnPrefix,
  LIKEPrice,
  fiatPrice,
  fiatPriceString,
  nftId,
  transactionHash,
}) {
  return {
    status,
    sessionId,
    isPendingClaim,
    errorMessage,
    wallet,
    classId,
    iscnPrefix,
    LIKEPrice,
    fiatPrice,
    fiatPriceString,
    nftId,
    transactionHash,
  };
}

export function filterBookPurchaseData({
  id,
  email,
  status,
  sessionId,
  isPendingClaim,
  isPaid,
  errorMessage,
  wallet,
  classId,
  priceInDecimal,
  price,
  priceIndex,
  txHash,
  message,
  from,
}) {
  return {
    id,
    email,
    status,
    sessionId,
    isPaid,
    isPendingClaim,
    errorMessage,
    wallet,
    classId,
    priceInDecimal,
    price,
    priceIndex,
    txHash,
    message,
    from,
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

export function filterNFTSubscriptionMintStatus({
  id,
  status,
  isProcessing,
  wallet,
  arweave,
  iscn,
  nftCover,
  nftClass,
  nftMint,
}) {
  return {
    id,
    status,
    isProcessing,
    wallet,
    arweave,
    iscn,
    nftCover,
    nftClass,
    nftMint,
  };
}
