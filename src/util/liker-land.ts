import {
  BOOK3_HOSTNAME,
  BOOK3_CART_PAGES,
} from '../constant';

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
  email,
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
  email?: string;
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
  if (email) {
    qsPayload.email = email;
  }
  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/store/claim?${qs}`, { language });
};

export const getBook3NFTGiftPageURL = ({
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
  return getBook3URL(`/gift/book?${qs}`, { language });
};

export const getPlusPageURL = ({
  language,
  coupon,
  plan,
  trial,
  from,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
}: {
  language?: string;
  coupon?: string;
  plan?: 'monthly' | 'yearly';
  trial?: '0' | '0d' | '1d' | '3d' | '5d' | '7d' | '14d' | '30d';
  from?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
}) => {
  const qsPayload: any = {};
  if (coupon) {
    qsPayload.coupon = coupon;
  }
  if (plan) {
    qsPayload.plan = plan;
  }
  if (trial) {
    qsPayload.trial = trial;
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
  return getBook3URL(`/plus?${qs}`, { language });
};

export const getPlusSuccessPageURL = ({
  period,
  tier,
  paymentId,
  hasFreeTrial,
  language,
  utmCampaign,
  utmSource,
  utmMedium,
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
}: {
  period: string;
  tier?: string;
  paymentId: string;
  hasFreeTrial: boolean;
  language?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  gaClientId?: string;
  gaSessionId?: string;
  gadClickId?: string;
  gadSource?: string;
}) => {
  const qsPayload: any = {
    redirect: '1',
    period,
    payment_id: paymentId,
    trial: hasFreeTrial ? '1' : '0',
  };
  // Only Civic needs signalling; Plus success URLs stay unchanged. The success
  // page reads this to poll for the tier and land Civic buyers on /account.
  if (tier === 'civic') {
    qsPayload.tier = tier;
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
  // {CHECKOUT_SESSION_ID} is a Stripe placeholder;
  // must stay literal (not URL-encoded) for Stripe to substitute it.
  return `${getBook3URL(`/plus/success?${qs}`, { language })}&session_id={CHECKOUT_SESSION_ID}`;
};

// Post-confirmation redirect for the Billing Portal tier-upgrade flow.
// Deliberately NOT `redirect=1` (getPlusSuccessPageURL): the success page keys
// gift-cart handling off that flag, and an in-place upgrade must not re-open a
// pre-existing gift cart. `via=portal` triggers the conversion logging instead.
export const getPlusUpgradeSuccessPageURL = ({
  period,
  tier,
  paymentId,
  language,
}: {
  period: string;
  tier: string;
  paymentId: string;
  language?: string;
}): string => {
  const qs = new URLSearchParams({
    via: 'portal',
    period,
    tier,
    payment_id: paymentId,
  }).toString();
  return getBook3URL(`/plus/success?${qs}`, { language });
};

export const getPlusGiftPageURL = ({
  period,
  quantity,
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
  quantity?: number;
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

  if (quantity && quantity > 1) {
    qsPayload.quantity = quantity;
  }

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
  email,
}: {
  cartId?: string;
  paymentId: string;
  token: string;
  language?: string;
  email?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (cartId) {
    qsPayload.cart_id = cartId;
  }
  if (email) {
    qsPayload.email = email;
  }

  const qs = new URLSearchParams(qsPayload).toString();
  return getBook3URL(`/gift/plus/claim?${qs}`, { language });
};

// Claim page for a shared-membership invite. Deliberately not locale-prefixed:
// the client contract is exactly /shared/claim?giver=...&invite=...&token=....
// `giver` is required — the claim endpoint addresses the invite doc under the
// giver's user record, so a link without it cannot be claimed.
export const getSharedMemberClaimURL = ({
  giverLikerId,
  inviteId,
  token,
}: {
  giverLikerId: string;
  inviteId: string;
  token: string;
}): string => {
  const qs = new URLSearchParams({ giver: giverLikerId, invite: inviteId, token }).toString();
  return `https://${BOOK3_HOSTNAME}/shared/claim?${qs}`;
};
