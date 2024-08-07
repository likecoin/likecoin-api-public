import { LIKER_LAND_HOSTNAME } from '../constant';

export const getLikerLandURL = (path = '', { language = 'en' }: { language?: string } = {}) => `https://${LIKER_LAND_HOSTNAME}${language ? `/${language}` : ''}${path}`;

interface GetLikerLandNFTPageURLParams {
  type?: 'nft_book' | 'writing_nft',
  language?: string
}
export const getLikerLandPortfolioPageURL = ({
  type = 'nft_book',
  language = 'en',
}: GetLikerLandNFTPageURLParams = {}): string => getLikerLandURL(`/feed?view=collectibles&tab=collected&type=${type}`, { language });

export const getLikerLandCartURL = ({
  language,
  type = 'book',
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  language?: string,
  type?: 'book' | 'wnft',
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {};
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/shopping-cart/${type}?${qs}`, { language });
};

export const getLikerLandNFTClassPageURL = ({
  classId,
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  classId: string,
  language?: string,
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {};
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/class/${classId}?${qs}`, { language });
};

export const getLikerLandNFTCollectionPageURL = ({
  collectionId,
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  collectionId: string,
  language?: string,
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {};
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/collection/${collectionId}?${qs}`, { language });
};

export const getLikerLandNFTClaimPageURL = ({
  classId,
  collectionId,
  cartId,
  paymentId,
  free = false,
  token,
  type = '',
  language,
  redirect = false,
  priceIndex,
  from,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  classId?: string;
  collectionId?: string;
  cartId?: string;
  paymentId: string;
  free?: boolean,
  token: string;
  type?: string;
  language?: string;
  redirect?: boolean;
  priceIndex?: number;
  from?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (classId) {
    qsPayload.class_id = classId;
  }

  if (collectionId) {
    qsPayload.collection_id = collectionId;
  }

  if (cartId) {
    qsPayload.cart_id = cartId;
  }

  if (redirect) {
    qsPayload.redirect = '1';
  }
  if (type) {
    qsPayload.type = type;
  }
  if (free) {
    qsPayload.free = '1';
  }
  if (priceIndex !== undefined) {
    qsPayload.price_index = priceIndex;
  }
  if (from) {
    qsPayload.from = from;
  }
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/claim?${qs}`, { language });
};

export const getLikerLandNFTGiftPageURL = ({
  classId,
  collectionId,
  cartId,
  paymentId,
  type = '',
  language,
  redirect = false,
  priceIndex,
  from,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  classId?: string;
  collectionId?: string;
  cartId?: string;
  paymentId: string;
  type?: string;
  language?: string;
  redirect?: boolean;
  priceIndex?: number;
  from?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
  };

  if (classId) {
    qsPayload.class_id = classId;
  }

  if (collectionId) {
    qsPayload.collection_id = collectionId;
  }

  if (redirect) {
    qsPayload.redirect = '1';
  }
  if (type) {
    qsPayload.type = type;
  }
  if (priceIndex !== undefined) {
    qsPayload.price_index = priceIndex;
  }
  if (from) {
    qsPayload.from = from;
  }
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/gift?${qs}`, { language });
};

export const getLikerLandNFTFiatStripePurchasePageURL = ({
  classId,
  paymentId,
  token,
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
}: {
  classId: string;
  paymentId: string;
  token: string;
  language?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    class_id: classId,
  };
  if (token) {
    qsPayload.claiming_token = token;
  }
  if (utmCampaign) {
    qsPayload.utm_campaign = utmCampaign;
  }
  if (utmSource) {
    qsPayload.utm_source = utmSource;
  }
  if (utmMedium) {
    qsPayload.utm_medium = utmMedium;
  }
  if (gaClientId) {
    qsPayload.ga_client_id = gaClientId;
  }
  if (gaSessionId) {
    qsPayload.ga_session_id = gaSessionId;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/fiat/stripe?${qs}`, { language });
};
