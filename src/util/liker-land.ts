import axios, { AxiosError } from 'axios';
import {
  LIKER_LAND_HOSTNAME,
  BOOK3_HOSTNAME,
  BOOK3_CART_PAGES,
} from '../constant';
import {
  LIKER_LAND_GET_WALLET_SECRET,
} from '../../config/config';

export const getLikerLandURL = (path = '', { language = '' }: { language?: string } = {}): string => `https://${LIKER_LAND_HOSTNAME}${language ? `/${language}` : ''}${path}`;

export const getBook3URL = (path = '', { language = 'zh' }: { language?: string } = {}): string => {
  const locale = language.startsWith('zh') ? '' : 'en';
  return `https://${BOOK3_HOSTNAME}${locale ? `/${locale}` : ''}${path}`;
};

interface GetBook3NFTPageURLParams {
  type?: 'nft_book' | 'writing_nft',
  language?: string,
}
export const getBook3PortfolioPageURL = ({
  language = '',
}: GetBook3NFTPageURLParams = {}): string => getBook3URL('/shelf', { language });

export const getBook3CartURL = ({
  language,
  type = 'book',
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
  page = 'list',
  from,
}: {
  language?: string,
  type?: 'book' | 'wnft',
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
  page?: 'list' | 'checkout';
  from?: string;
}): string => {
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  if (from) {
    qsPayload.from = from;
  }
  const qs = new URLSearchParams(qsPayload).toString();

  if (type !== 'book') {
    // eslint-disable-next-line no-console
    console.warn(`Unsupported type "${type}" for 3ook.com site`);
  }
  let path = '';
  if (BOOK3_CART_PAGES.includes(page)) {
    path += `/${page}`;
  }
  return getBook3URL(`${path}?${qs}`, { language });
};

export const getBook3NFTClassPageURL = ({
  classId,
  priceIndex,
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
  from,
}: {
  classId: string,
  priceIndex?: number;
  language?: string,
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
  from?: string;
}): string => {
  const qsPayload: Record<string, string> = {};
  if (priceIndex) {
    qsPayload.price_index = priceIndex.toString();
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  if (from) {
    qsPayload.from = from;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/store/${classId}?${qs}`, { language });
};

export const getBook3NFTClaimPageURL = ({
  classId,
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
  gadClickId,
  gadSource,
}: {
  classId?: string;
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
  gadClickId?: string;
  gadSource?: string;
}): string => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (classId) {
    qsPayload.class_id = classId;
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/store/claim?${qs}`, { language });
};

export const getLikerLandNFTGiftPageURL = ({
  classId,
  cartId,
  paymentId,
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
  gadClickId,
  gadSource,
}: {
  classId?: string;
  cartId?: string;
  paymentId: string;
  token: string
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
  gadClickId?: string;
  gadSource?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (classId) {
    qsPayload.class_id = classId;
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getLikerLandURL(`/nft/gift?${qs}`, { language });
};

export const getPlusPageURL = ({
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
}: {
  language?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/plus?${qs}`, { language });
};

export const getPlusGiftPageURL = ({
  period,
  cartId,
  paymentId,
  token,
  language,
  redirect = false,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
}: {
  period: string;
  cartId: string;
  paymentId: string;
  token: string;
  language?: string;
  redirect?: boolean;
  from?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
    period,
  };

  if (cartId) {
    qsPayload.cart_id = cartId;
  }

  if (redirect) {
    qsPayload.redirect = '1';
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
  if (gadClickId) {
    qsPayload.gclid = gadClickId;
  }
  if (gadSource) {
    qsPayload.gad_source = gadSource;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/gift/plus/success?${qs}`, { language });
};

export const getPlusGiftPageClaimURL = ({
  cartId,
  paymentId,
  token,
  language,
}: {
  cartId?: string;
  paymentId: string;
  token: string;
  language?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (cartId) {
    qsPayload.cart_id = cartId;
  }

  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/gift/plus/claim?${qs}`, { language });
};

export async function findLikerLandWalletUserWithVerifiedEmail(email) {
  try {
    const { data } = await axios.get(`https://${LIKER_LAND_HOSTNAME}/api/v2/users/wallet`, {
      headers: { 'x-likerland-api-key': LIKER_LAND_GET_WALLET_SECRET },
      params: { email },
    });
    return data;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    return null;
  }
}

export async function fetchLikerLandWalletUserInfo(wallet) {
  try {
    const { data } = await axios.get(`https://${LIKER_LAND_HOSTNAME}/api/v2/users/wallet`, {
      headers: { 'x-likerland-api-key': LIKER_LAND_GET_WALLET_SECRET },
      params: { wallet },
    });
    return data;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    return null;
  }
}

export async function migrateLikerLandEVMWallet(likeWallet: string, evmWallet: string) {
  try {
    const { data } = await axios.post(`https://${LIKER_LAND_HOSTNAME}/api/v2/users/wallet/evm/migrate`, {
      evmWallet,
    }, {
      headers: { 'x-likerland-api-key': LIKER_LAND_GET_WALLET_SECRET },
      params: { wallet: likeWallet },
    });
    return { user: data, error: null };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const errorBody = axiosError.response?.data;
      const errorMessage = errorBody || error.message;
      // eslint-disable-next-line no-console
      console.error(`Error migrating Liker Land EVM wallet: ${errorMessage}`);
      return { user: null, error: errorMessage };
    }
    // eslint-disable-next-line no-console
    console.error(error);
    return { user: null, error: (error as Error).message };
  }
}
