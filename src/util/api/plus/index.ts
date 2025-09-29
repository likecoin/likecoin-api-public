import type Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';

import {
  BOOK3_HOSTNAME, PLUS_MONTHLY_PRICE, PLUS_YEARLY_PRICE, PUBSUB_TOPIC_MISC,
} from '../../../constant';
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
import { sendPlusSubscriptionSlackNotification } from '../../slack';
import { createAirtableSubscriptionPaymentRecord } from '../../airtable';
import { createFreeBookCartFromSubscription } from '../likernft/book/cart';
import { ValidationError } from '../../ValidationError';
import logPixelEvents from '../../fbq';
import { updateIntercomUserLikerPlusStatus } from '../../intercom';

export async function processStripeSubscriptionInvoice(
  invoice: Stripe.Invoice,
  req: Express.Request,
) {
  const {
    billing_reason: billingReason,
    discount,
    subscription_details: subscriptionDetails,
  } = invoice;
  const subscriptionId = invoice.subscription as string;
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
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
  const {
    start_date: startDate,
    items: { data: [item] },
    metadata: subscriptionMetadata,
    customer,
  } = subscription;
  const stripeCustomer = customer as Stripe.Customer;
  const {
    from,
    giftClassId,
    giftPriceIndex = '0',
    giftCartId: existingGiftCartId,
    utmCampaign,
    utmSource,
    utmMedium,
    paymentId,
    isUpgradingPrice,
  } = subscriptionMetadata || {};
  const productId = item.price.product as string;
  if (productId !== LIKER_PLUS_PRODUCT_ID) {
    // eslint-disable-next-line no-console
    console.warn(`Unexpected product ID in stripe subscription: ${productId} ${subscription}`);
    return;
  }

  const isNewSubscription = !user.likerPlus || user.likerPlus.since !== startDate * 1000;
  const price = invoice.amount_paid / 100;
  const priceName = item.price.nickname || '';
  const currency = invoice.currency.toUpperCase();
  const priceWithCurrency = `${price.toFixed(2)} ${currency}`;
  const isSubscriptionCreation = billingReason === 'subscription_create';
  const isYearlySubscription = item.plan.interval === 'year';
  const amountPaid = invoice.amount_paid / 100;

  let giftCartId = '';
  if ((isSubscriptionCreation || isUpgradingPrice)
      && isYearlySubscription
      && giftClassId
      && !existingGiftCartId) {
    try {
      giftCartId = uuidv4();
      const metadata: Stripe.MetadataParam = {
        giftCartId,
      };
      if (isUpgradingPrice) metadata.isUpgradingPrice = '';
      await stripe.subscriptions.update(subscriptionId, {
        metadata,
      });
      const result = await createFreeBookCartFromSubscription({
        cartId: giftCartId,
        classId: giftClassId,
        priceIndex: parseInt(giftPriceIndex, 10) || 0,
        amountPaid,
      }, {
        evmWallet,
        email: stripeCustomer.email,
      });
      if (result) {
        const {
          cartId,
          paymentId: giftPaymentId,
          claimToken,
        } = result;
        await stripe.subscriptions.update(subscriptionId, {
          metadata: {
            ...subscriptionMetadata,
            giftClassId,
            giftCartId: cartId,
            giftPaymentId,
            giftClaimToken: claimToken,
          },
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error creating gift cart from subscription:', error);
    }
  }

  const customerId = stripeCustomer.id;
  const period = item.plan.interval;
  const since = startDate * 1000; // Convert to milliseconds
  const currentPeriodStart = subscription.current_period_start * 1000; // Convert to milliseconds
  const currentPeriodEnd = subscription.current_period_end * 1000; // Convert to milliseconds
  await userCollection.doc(likerId).update({
    likerPlus: {
      period,
      since,
      currentPeriodStart,
      currentPeriodEnd,
      subscriptionId,
      customerId,
    },
  });

  await updateIntercomUserLikerPlusStatus({
    userId: likerId,
    isLikerPlus: true,
  });

  if (isSubscriptionCreation) {
    await logPixelEvents('Purchase', {
      email: stripeCustomer.email || undefined,
      items: [{
        productId: `plus-${period}ly`,
        quantity: 1,
      }],
      value: period === 'year' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE,
      currency: 'USD',
      paymentId,
      evmWallet: req.user?.evmWallet,
    });
  }

  await Promise.all([
    sendPlusSubscriptionSlackNotification({
      subscriptionId,
      email: user.email || 'N/A',
      priceWithCurrency,
      isNew: isNewSubscription,
      userId: likerId,
      stripeCustomerId: customerId,
      method: 'stripe',
      isTrial: false,
    }),
    createAirtableSubscriptionPaymentRecord({
      subscriptionId,
      customerId,
      customerEmail: user.email || '',
      customerUserId: likerId,
      customerWallet: user.evmWallet,
      productId,
      priceId: item.price.id,
      priceName,
      price,
      currency,
      invoiceId: invoice.id,
      couponId: discount?.coupon.id || '',
      couponName: discount?.coupon.name || '',
      since,
      periodInterval: period,
      periodStartAt: currentPeriodStart,
      periodEndAt: currentPeriodEnd,
      isNew: isNewSubscription,
      isTrial: false,
      channel: from,
      utmCampaign,
      utmMedium,
      utmSource,
      giftCartId,
    }),
  ]);

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'PlusSubscriptionInvoiceProcessed',
    subscriptionId,
    invoiceId: invoice.id,
    likerId,
    period: item.plan.interval,
    price: amountPaid,
    customerId,
    evmWallet,
    likeWallet,
    utmCampaign,
    utmSource,
    utmMedium,
  });
}

export async function createNewPlusCheckoutSession(
  {
    period,
    trialPeriodDays = 0,
    mustCollectPaymentMethod = true,
    giftClassId,
    giftPriceIndex,
  }: {
    period: 'monthly' | 'yearly',
    trialPeriodDays?: number,
    mustCollectPaymentMethod?: boolean,
    giftClassId?: string,
    giftPriceIndex?: string,
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
    },
  },
  req,
) {
  const paymentId = uuidv4();
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
        if (likerUserInfo.isLikerPlus) {
          throw new ValidationError('User already has a Liker Plus subscription.', 429);
        }
      }
      if (bookUserInfo) customerId = bookUserInfo.stripeCustomerId;
    }
  }
  const subscriptionMetadata: Stripe.MetadataParam = {};
  if (likeWallet) subscriptionMetadata.likeWallet = likeWallet;
  if (evmWallet) subscriptionMetadata.evmWallet = evmWallet;
  if (from) subscriptionMetadata.from = from;
  if (giftClassId) subscriptionMetadata.giftClassId = giftClassId;
  if (giftPriceIndex !== undefined) subscriptionMetadata.giftPriceIndex = giftPriceIndex;
  if (utm?.campaign) subscriptionMetadata.utmCampaign = utm.campaign;
  if (utm?.source) subscriptionMetadata.utmSource = utm.source;
  if (utm?.medium) subscriptionMetadata.utmMedium = utm.medium;
  const metadata: Stripe.MetadataParam = { ...subscriptionMetadata };
  if (gaClientId) metadata.gaClientId = gaClientId;
  if (gaSessionId) metadata.gaSessionId = gaSessionId;
  if (gadClickId) metadata.gadClickId = gadClickId;
  if (gadSource) metadata.gadSource = gadSource;
  if (referrer) metadata.referrer = referrer.substring(0, 500);
  if (userAgent) metadata.userAgent = userAgent;
  if (clientIp) metadata.clientIp = clientIp;
  if (fbClickId) metadata.fbClickId = fbClickId;

  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: subscriptionMetadata,
  };
  const hasFreeTrial = trialPeriodDays > 0;
  if (hasFreeTrial) {
    subscriptionData.trial_period_days = trialPeriodDays;
    if (!mustCollectPaymentMethod) {
      subscriptionData.trial_settings = {
        end_behavior: {
          missing_payment_method: 'cancel',
        },
      };
    }
  }
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
    subscription_data: subscriptionData,
    success_url: `https://${BOOK3_HOSTNAME}/plus/success?redirect=1&period=${period}&payment_id=${paymentId}&trial=${hasFreeTrial ? '1' : '0'}`,
    cancel_url: `https://${BOOK3_HOSTNAME}/plus`,
    payment_method_collection: mustCollectPaymentMethod ? 'always' : 'if_required',
  };
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

export async function updateSubscriptionPeriod(
  subscriptionId: string,
  period: 'monthly' | 'yearly',
  {
    giftClassId,
    giftPriceIndex,
  }: {
    giftClassId?: string;
    giftPriceIndex?: string;
  },
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const { metadata } = subscription;
  if (giftClassId) metadata.giftClassId = giftClassId;
  if (giftPriceIndex) metadata.giftPriceIndex = giftPriceIndex;
  if (period === 'yearly') metadata.isUpgradingPrice = 'true';
  await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [
        {
          id: subscription.items.data[0].id,
          price: period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID,
        },
      ],
      metadata,
    },
  );
}
