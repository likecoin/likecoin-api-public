import type Stripe from 'stripe';

import { BOOK3_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import { getBookUserInfoFromWallet } from '../likernft/book/user';
import stripe from '../../stripe';
import { userCollection } from '../../firebase';
import publisher from '../../gcloudPub';

import {
  LIKER_PLUS_MONTHLY_PRICE_ID,
  LIKER_PLUS_YEARLY_PRICE_ID,
  LIKER_PLUS_PRODUCT_ID,
} from '../../../../config/config';
import { getUserWithCivicLikerPropertiesByWallet } from '../users/getPublicInfo';

export async function processStripeSubscriptionInvoice(
  invoice: Stripe.Invoice,
  req: Express.Request,
) {
  const {
    subscription: subscriptionId,
    subscription_details: subscriptionDetails,
  } = invoice;
  const {
    evmWallet,
    likeWallet,
  } = subscriptionDetails?.metadata || {};
  if (!evmWallet && !likeWallet) {
    // eslint-disable-next-line no-console
    console.warn(`No evmWallet or likeWallet found in subscription: ${subscriptionId}`);
    return;
  }
  const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet || likeWallet);
  if (!user) {
    // eslint-disable-next-line no-console
    console.warn(`No likerId found for evmWallet: ${evmWallet}, likeWallet: ${likeWallet}, subscription: ${subscriptionId}`);
    return;
  }
  const likerId = user.user;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
  const {
    start_date: startDate,
    items: { data: [item] },
  } = subscription;
  const productId = item.price.product as string;
  if (productId !== LIKER_PLUS_PRODUCT_ID) {
    // eslint-disable-next-line no-console
    console.warn(`Unexpected product ID in stripe subscription: ${productId} ${subscription}`);
    return;
  }
  await userCollection.doc(likerId).update({
    likerPlus: {
      period: item.plan.interval,
      since: startDate * 1000, // Convert to milliseconds
      currentPeriodStart: subscription.current_period_start * 1000, // Convert to milliseconds
      currentPeriodEnd: subscription.current_period_end * 1000, // Convert to milliseconds
      subscriptionId,
      customerId: subscription.customer as string,
    },
  });

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'PlusSubscriptionInvoiceProcessed',
    subscriptionId,
    invoiceId: invoice.id,
    likerId,
    period: item.plan.interval,
    customerId: subscription.customer as string,
    evmWallet,
    likeWallet,
  });
}

export async function createNewPlusCheckoutSession(
  period: 'monthly' | 'yearly',
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
    },
  },
  req,
) {
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
      if (likerUserInfo) userEmail = likerUserInfo.email;
      if (bookUserInfo) customerId = bookUserInfo.stripeCustomerId;
    }
  }
  const subscriptionMetadata: Stripe.MetadataParam = {};
  if (likeWallet) subscriptionMetadata.likeWallet = likeWallet;
  if (evmWallet) subscriptionMetadata.evmWallet = evmWallet;
  if (from) subscriptionMetadata.from = from;
  const metadata: Stripe.MetadataParam = { ...subscriptionMetadata };
  if (gaClientId) metadata.gaClientId = gaClientId;
  if (gaSessionId) metadata.gaSessionId = gaSessionId;
  if (gadClickId) metadata.gadClickId = gadClickId;
  if (gadSource) metadata.gadSource = gadSource;
  if (utm?.campaign) metadata.utmCampaign = utm.campaign;
  if (utm?.source) metadata.utmSource = utm.source;
  if (utm?.medium) metadata.utmMedium = utm.medium;
  if (referrer) metadata.referrer = referrer.substring(0, 500);
  if (userAgent) metadata.userAgent = userAgent;
  if (clientIp) metadata.clientIp = clientIp;
  if (fbClickId) metadata.fbClickId = fbClickId;
  const payload: Stripe.Checkout.SessionCreateParams = {
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    line_items: [
      {
        price: period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID,
        quantity: 1,
      },
    ],
    metadata,
    mode: 'subscription',
    subscription_data: { metadata: subscriptionMetadata },
    success_url: `https://${BOOK3_HOSTNAME}/plus/success?redirect=1&period=${period}`,
    cancel_url: `https://${BOOK3_HOSTNAME}/plus`,
  };
  if (customerId) {
    payload.customer = customerId;
  } else {
    payload.customer_email = userEmail;
  }
  const session = await stripe.checkout.sessions.create(payload);
  return session;
}
