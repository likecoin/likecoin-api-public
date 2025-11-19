import crypto from 'crypto';
import type Stripe from 'stripe';
import uuidv4 from 'uuid/v4';

import stripe, { getStripePromotionFromCode } from '../../stripe';
import { FieldValue, likePlusGiftCartCollection } from '../../firebase';
import {
  LIKER_PLUS_GIFT_MONTHLY_PRICE_ID,
  LIKER_PLUS_GIFT_YEARLY_PRICE_ID,
} from '../../../../config/config';
import { ValidationError } from '../../ValidationError';
import { sendPlusGiftPendingClaimEmail } from '../../ses';
import { getBookUserInfoFromWallet } from '../likernft/book/user';
import { getPlusGiftPageURL, getPlusPageURL } from '../../liker-land';
import type { BookGiftInfo } from '../../../types/book';

export async function createPlusGiftCheckoutSession(
  {
    period = 'yearly',
    giftInfo,
    coupon,
    language,
  }: {
    period: 'monthly' | 'yearly',
    giftInfo: BookGiftInfo,
    coupon?: string,
    language?: 'en' | 'zh',
  },
  {
    from,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    referrer,
    userAgent,
    clientIp,
    utm,
  }: {
    from?: string,
    gaClientId?: string,
    gaSessionId?: string,
    gadClickId?: string,
    gadSource?: string,
    fbClickId?: string,
    referrer?: string,
    userAgent?: string,
    clientIp?: string,
    utm?: {
      campaign?: string,
      source?: string,
      medium?: string,
      content?: string,
      term?: string,
    },
  },
  req,
) {
  const paymentId = uuidv4();
  const cartId = paymentId;
  const claimToken = crypto.randomBytes(32).toString('hex');
  const {
    wallet,
    likeWallet,
    evmWallet,
  } = req.user;
  let userEmail;
  let customerId;
  if (wallet) {
    const userInfo = await getBookUserInfoFromWallet(wallet);
    if (userInfo) {
      const { bookUserInfo, likerUserInfo } = userInfo;
      if (likerUserInfo) {
        userEmail = likerUserInfo.email;
      }
      if (bookUserInfo) {
        customerId = bookUserInfo.stripeCustomerId;
      }
    }
  }
  const sessionMetadata: Stripe.MetadataParam = {
    store: 'plus_gift',
    paymentId,
    cartId: paymentId,
    claimToken,
  };
  if (likeWallet) sessionMetadata.likeWallet = likeWallet;
  if (evmWallet) sessionMetadata.evmWallet = evmWallet;
  if (from) sessionMetadata.from = from;
  if (giftInfo) {
    sessionMetadata.giftInfo = giftInfo.toEmail;
    sessionMetadata.giftToEmail = giftInfo.toEmail;
    if (giftInfo.fromName) sessionMetadata.giftFromName = giftInfo.fromName;
    if (giftInfo.toName) sessionMetadata.giftToName = giftInfo.toName;
    if (giftInfo.message) sessionMetadata.giftMessage = giftInfo.message;
  }
  if (utm?.campaign) sessionMetadata.utmCampaign = utm.campaign;
  if (utm?.source) sessionMetadata.utmSource = utm.source;
  if (utm?.medium) sessionMetadata.utmMedium = utm.medium;
  if (utm?.content) sessionMetadata.utmContent = utm.content;
  if (utm?.term) sessionMetadata.utmTerm = utm.term;
  if (userAgent) sessionMetadata.userAgent = userAgent;
  if (clientIp) sessionMetadata.clientIp = clientIp;
  if (fbClickId) sessionMetadata.fbClickId = fbClickId;
  if (gaClientId) sessionMetadata.gaClientId = gaClientId;
  if (gaSessionId) sessionMetadata.gaSessionId = gaSessionId;
  if (gadClickId) sessionMetadata.gadClickId = gadClickId;
  if (gadSource) sessionMetadata.gadSource = gadSource;
  if (referrer) sessionMetadata.referrer = referrer.substring(0, 500);

  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
  if (coupon) {
    try {
      const promotion = await getStripePromotionFromCode(coupon);
      if (promotion) {
        discounts.push({ promotion_code: promotion.id });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  const isYearly = period === 'yearly';

  const payload: Stripe.Checkout.SessionCreateParams = {
    billing_address_collection: 'auto',
    line_items: [
      {
        price: isYearly ? LIKER_PLUS_GIFT_YEARLY_PRICE_ID : LIKER_PLUS_GIFT_MONTHLY_PRICE_ID,
        quantity: 1,
      },
    ],
    metadata: sessionMetadata,
    payment_intent_data: {
      capture_method: 'automatic',
      metadata: sessionMetadata,
    },
    mode: 'payment',
    success_url: getPlusGiftPageURL({
      period,
      cartId,
      paymentId,
      token: claimToken,
      language,
      redirect: true,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
    cancel_url: getPlusPageURL({
      language,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
  };
  if (discounts.length) {
    payload.discounts = discounts;
  } else {
    payload.allow_promotion_codes = true;
  }
  if (customerId) {
    payload.customer = customerId;
  } else {
    payload.customer_email = userEmail;
  }
  const session = await stripe.checkout.sessions.create(payload);
  return {
    session,
    paymentId,
    email: userEmail,
  };
}
