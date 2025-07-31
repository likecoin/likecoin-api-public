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
    evmWallet,
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
    likerPlusSince,
    isLikerPlus,
    likerPlus,
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
    evmWallet,
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
    likerPlusSince,
    isLikerPlus,
    likerPlus,
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
    evmWallet,
    isSubscribedCivicLiker,
    isCivicLikerTrial,
    civicLikerSince,
    likerPlusSince,
    isLikerPlus,
    description,
  } = userObject;
  const output: any = {
    user,
    displayName,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    evmWallet,
    isCivicLikerTrial,
    isSubscribedCivicLiker,
    civicLikerSince,
    likerPlusSince,
    isLikerPlus,
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
  classId: legacyClassId,
  iscnPrefix: legacyISCNPrefix,
  purchaseInfoList: purchaseInfoListInput,
  LIKEPrice,
  fiatPrice,
  fiatPriceString,
  transactionHash,
}) {
  const payload = {
    status,
    sessionId,
    isPendingClaim,
    errorMessage,
    wallet,
    LIKEPrice,
    fiatPrice,
    fiatPriceString,
    transactionHash,
  } as any;
  if (purchaseInfoListInput && purchaseInfoListInput.length) {
    payload.purchaseInfoList = purchaseInfoListInput.map((p) => ({
      iscnPrefix: p.iscnPrefix,
      classId: p.classId,
      LIKEPrice: p.LIKEPrice,
    }));
  } else {
    // Handle legacy single NFT class purchase
    payload.purchaseInfoList = [{
      iscnPrefix: legacyISCNPrefix,
      classId: legacyClassId,
      LIKEPrice,
    }];
  }
  return payload;
}

export function filterBookPurchaseData({
  id,
  email,
  phone,
  status,
  shippingStatus,
  shippingDetails,
  shippingCost,
  shippingMessage,
  isPhysicalOnly,
  sessionId,
  isPendingClaim,
  isPaid,
  errorMessage,
  wallet,
  classId,
  priceInDecimal,
  price,
  originalPrice,
  originalPriceInDecimal,
  priceIndex,
  priceName,
  coupon,
  txHash,
  message,
  from,
  giftInfo,
  timestamp,
  autoMemo,
  isAutoDeliver,
  quantity = 1,
  classIds,
  classIdsWithPrice,
  collectionIds,
  collectionIdsWithPrice,
}) {
  return {
    id,
    email,
    phone,
    status,
    shippingStatus,
    shippingDetails,
    shippingCost,
    shippingMessage,
    isPhysicalOnly,
    sessionId,
    isPaid,
    isPendingClaim,
    errorMessage,
    wallet,
    classId,
    priceInDecimal,
    price,
    originalPrice,
    originalPriceInDecimal,
    priceIndex,
    priceName,
    coupon,
    txHash,
    message,
    from,
    giftInfo,
    timestamp: timestamp?.toMillis(),
    autoMemo,
    isAutoDeliver,
    quantity,
    classIds,
    classIdsWithPrice,
    collectionIds,
    collectionIdsWithPrice,
  };
}

export function filterBookPurchaseCommission({
  type,
  ownerWallet,
  classId,
  priceIndex,
  collectionId,
  transferId,
  stripeConnectAccountId,
  paymentId,
  amountTotal,
  amount,
  currency,
  timestamp,
}) {
  return {
    type,
    ownerWallet,
    classId,
    priceIndex,
    collectionId,
    transferId,
    stripeConnectAccountId,
    paymentId,
    amountTotal,
    amount,
    currency,
    timestamp: timestamp?.toMillis(),
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

export function filterNFTBookPricesInfo(inputPrices, isOwner = false) {
  let sold = 0;
  let stock = 0;
  const prices: any[] = [];
  inputPrices.forEach((p, i) => {
    const {
      name,
      description,
      priceInDecimal,
      hasShipping,
      isPhysicalOnly,
      isAllowCustomPrice,
      isUnlisted,
      sold: pSold = 0,
      stock: pStock = 0,
      isAutoDeliver,
      autoMemo,
      index = i,
      order,
    } = p;
    const price = priceInDecimal / 100;
    const payload: any = {
      index,
      price,
      name,
      description,
      stock: isUnlisted ? 0 : pStock,
      isSoldOut: pStock <= 0,
      isAutoDeliver,
      isUnlisted,
      autoMemo,
      hasShipping,
      isPhysicalOnly,
      isAllowCustomPrice,
      order: order ?? index,
    };
    if (isOwner) {
      payload.sold = pSold;
      payload.stock = pStock;
    }
    prices.push(payload);
    sold += pSold;
    stock += pStock;
  });
  prices.sort((a, b) => a.order - b.order);
  return {
    sold,
    stock,
    prices,
  };
}

export function filterNFTBookListingInfo(bookInfo, isOwner = false) {
  const {
    id: inputId,
    classId,
    likeClassId,
    evmClassId,
    chain,
    prices: inputPrices = [],
    shippingRates,
    pendingNFTCount,
    ownerWallet,
    moderatorWallets = [],
    notificationEmails,
    connectedWallets,
    mustClaimToView = false,
    hideDownload = false,
    hideAudio = false,
    enableCustomMessagePage,
    tableOfContents,
    signedMessageText,
    enableSignatureImage,
    recommendedClassIds,
    inLanguage,
    name,
    description,
    keywords,
    thumbnailUrl,
    author,
    usageInfo,
    isbn,
    timestamp,
    isHidden,
  } = bookInfo;
  const { stock, sold, prices } = filterNFTBookPricesInfo(inputPrices, isOwner);
  const id = inputId || classId;
  const payload: any = {
    id,
    classId: id,
    likeClassId,
    evmClassId,
    chain,
    prices,
    shippingRates,
    isSoldOut: stock <= 0,
    stock,
    ownerWallet,
    mustClaimToView,
    hideDownload,
    hideAudio,
    enableCustomMessagePage,
    tableOfContents,
    signedMessageText,
    enableSignatureImage,
    recommendedClassIds,
    inLanguage,
    name,
    description,
    keywords,
    thumbnailUrl,
    author,
    usageInfo,
    isbn,
    timestamp: timestamp?.toMillis(),
    isHidden,
  };
  if (isOwner) {
    payload.sold = sold;
    payload.pendingNFTCount = pendingNFTCount;
    payload.moderatorWallets = moderatorWallets;
    payload.notificationEmails = notificationEmails;
    payload.connectedWallets = connectedWallets;
  }
  return payload;
}

export function filterNFTCollectionTypePayload(type, payload, isOwner = false) {
  if (type === 'book') {
    const {
      successUrl,
      cancelUrl,
      priceInDecimal,
      stock,
      sold,
      pendingNFTCount,
      isAllowCustomPrice,
      isUnlisted,
      isPhysicalOnly,
      hasShipping,
      shippingRates,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      isAutoDeliver,
      autoMemo,
      recommendedClassIds,
    } = payload;
    const publicInfo = {
      priceInDecimal,
      stock: isUnlisted ? 0 : stock,
      isAllowCustomPrice,
      isUnlisted,
      isAutoDeliver,
      hasShipping,
      shippingRates,
      isPhysicalOnly,
      recommendedClassIds,
    };
    if (!isOwner) {
      return publicInfo;
    }
    return {
      ...publicInfo,
      stock,
      successUrl,
      cancelUrl,
      sold,
      pendingNFTCount,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      autoMemo,
    };
  }
  return {
  };
}

export function filterNFTCollection({
  ownerWallet,
  classIds,
  name,
  description,
  chain,
  image,
  type,
  typePayload,
  timestamp,
}, isOwner = false) {
  return {
    ownerWallet,
    classIds,
    name,
    description,
    chain,
    image,
    type,
    typePayload: {
      ...filterNFTCollectionTypePayload(type, typePayload, isOwner),
    },
    timestamp: timestamp?.toMillis(),
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
