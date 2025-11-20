import bech32 from 'bech32';
import {
  ONE_DAY_IN_MS,
  MIN_USER_ID_LENGTH,
  MAX_USER_ID_LENGTH,
} from '../constant';
import type { UserCivicLikerProperties } from '../types/user';
import type {
  UserDataFiltered,
  UserDataMin,
  UserDataScopedFiltered,
  AppMetaFiltered,
} from '../types/validation';
import type { TxData } from '../types/transaction';
import type {
  LikeNFTISCNData,
  LikeNFTMetadata,
  LikeNFTMetadataFiltered,
} from '../types/nft';
import type {
  BookPurchaseData,
  BookPurchaseDataFiltered,
  BookPurchaseCommission,
  BookPurchaseCommissionFiltered,
  NFTBookPrice,
  NFTBookPriceFiltered,
  NFTBookPricesInfoFiltered,
  NFTBookListingInfo,
  NFTBookListingInfoFiltered,
  PlusGiftCartData,
  PlusGiftCartDataFiltered,
} from '../types/book';
import type {
  OAuthClientInfo,
  AppMeta,
  NotificationData,
  BookmarkData,
  FollowData,
} from '../types/firestore';

export function checkAddressValid(addr: string): boolean {
  return addr.length === 42 && addr.substr(0, 2) === '0x';
}

export function checkUserNameValid(user: string): boolean {
  return !!user && (/^[a-z0-9-_]+$/.test(user) && user.length >= MIN_USER_ID_LENGTH && user.length <= MAX_USER_ID_LENGTH);
}

export function checkCosmosAddressValid(addr: string, prefix = 'cosmos'): boolean {
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

export function filterUserData(u: UserCivicLikerProperties): UserDataFiltered {
  const {
    user,
    bonusCooldown = 0,
    displayName,
    description,
    email,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    evmWallet,
    referrer,
    isEmailVerified,
    isEmailEnabled,
    authCoreUserId,
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
    isLikerPlusTrial,
    likerPlusPeriod,
    locale,
  } = u;
  return {
    user,
    bonusCooldown: bonusCooldown > Date.now() ? bonusCooldown : undefined,
    displayName,
    description,
    email,
    avatar,
    wallet,
    cosmosWallet,
    likeWallet,
    evmWallet,
    referrer: !!referrer,
    isEmailVerified,
    isEmailEnabled,
    isAuthCore: !!authCoreUserId,
    read: {},
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
    isLikerPlusTrial,
    likerPlusPeriod,
    locale,
  };
}

export function filterUserDataMin(
  userObject: UserCivicLikerProperties | UserDataMin,
  types: string[] = [],
): UserDataMin {
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
    isLikerPlusTrial,
    description,
  } = userObject;
  const output: UserDataMin = {
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
    isLikerPlusTrial,
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

export function filterUserDataScoped(
  u: UserCivicLikerProperties,
  scope: string[] = [],
): UserDataScopedFiltered {
  const user = filterUserData(u);
  let output: UserDataScopedFiltered = filterUserDataMin(u);
  if (scope.includes('read:plus')) {
    output.likerPlusPeriod = user.likerPlusPeriod;
  }
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
}: TxData): TxData {
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
}: LikeNFTISCNData): LikeNFTISCNData {
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
}: LikeNFTMetadata): LikeNFTMetadataFiltered {
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
}: BookPurchaseData): BookPurchaseDataFiltered {
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
}: BookPurchaseCommission): BookPurchaseCommissionFiltered {
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

export function filterPlusGiftCartData({
  id,
  email,
  status,
  sessionId,
  errorMessage,
  wallet,
  period,
  giftInfo,
  timestamp,
  claimTimestamp,
}: PlusGiftCartData): PlusGiftCartDataFiltered {
  return {
    id,
    email,
    status,
    sessionId,
    errorMessage,
    wallet,
    period,
    giftInfo,
    timestamp,
    claimTimestamp,
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
}: OAuthClientInfo): OAuthClientInfo {
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
}: AppMeta): AppMetaFiltered {
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
}: NotificationData): NotificationData {
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
}: BookmarkData): BookmarkData {
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
}: FollowData): FollowData {
  return {
    id,
    isFollowed,
    ts,
  };
}

export function filterNFTBookPricesInfo(
  inputPrices: NFTBookPrice[],
  isOwner = false,
): NFTBookPricesInfoFiltered {
  let sold = 0;
  let stock = 0;
  const prices: NFTBookPriceFiltered[] = [];
  inputPrices.forEach((p, i) => {
    const {
      name,
      description,
      priceInDecimal,
      isAllowCustomPrice,
      isTippingEnabled,
      isUnlisted,
      sold: pSold = 0,
      stock: pStock = 0,
      isAutoDeliver,
      autoMemo,
      index = i,
      order,
    } = p;
    const price = priceInDecimal / 100;
    const payload: NFTBookPriceFiltered = {
      index,
      price,
      name,
      description,
      stock: isUnlisted ? 0 : pStock,
      isSoldOut: isAutoDeliver ? false : pStock <= 0,
      isAutoDeliver,
      isUnlisted,
      autoMemo,
      isAllowCustomPrice,
      isTippingEnabled: !priceInDecimal || isTippingEnabled,
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

export function filterNFTBookListingInfo(
  bookInfo: NFTBookListingInfo,
  isOwner = false,
): NFTBookListingInfoFiltered {
  const {
    id: inputId,
    classId,
    likeClassId,
    evmClassId,
    redirectClassId,
    chain,
    prices: inputPrices = [],
    pendingNFTCount,
    ownerWallet,
    moderatorWallets = [],
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
    descriptionFull,
    descriptionSummary,
    keywords,
    thumbnailUrl,
    author,
    usageInfo,
    isbn,
    timestamp,
    isHidden,
    isApprovedForSale,
    isApprovedForIndexing,
    isApprovedForAds,
    approvalStatus,
  } = bookInfo;
  const { stock, sold, prices } = filterNFTBookPricesInfo(inputPrices, isOwner);
  const id = inputId || classId;
  const payload: NFTBookListingInfoFiltered = {
    id,
    classId: id,
    likeClassId,
    evmClassId,
    redirectClassId,
    chain,
    prices,
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
    descriptionFull,
    descriptionSummary,
    keywords,
    thumbnailUrl,
    author,
    usageInfo,
    isbn,
    timestamp: timestamp?.toMillis(),
    isHidden,
    // Approval flags - default to true for backward compatibility with existing books
    isApprovedForSale: isApprovedForSale !== undefined ? isApprovedForSale : true,
    isApprovedForIndexing: isApprovedForIndexing !== undefined ? isApprovedForIndexing : true,
    isApprovedForAds: isApprovedForAds !== undefined ? isApprovedForAds : true,
  };
  if (isOwner) {
    payload.sold = sold;
    payload.pendingNFTCount = pendingNFTCount;
    payload.moderatorWallets = moderatorWallets;
    payload.connectedWallets = connectedWallets;
    payload.approvalStatus = approvalStatus || 'approved';
  }
  return payload;
}
