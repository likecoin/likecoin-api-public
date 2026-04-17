import type Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import type { LikerPlusSubscriptionStatus } from '../../../types/user';

import { getPlusPageURL, getPlusSuccessPageURL } from '../../liker-land';
import {
  PLUS_PAID_TRIAL_PERIOD_DAYS_THRESHOLD,
  PLUS_PAID_TRIAL_PRICE,
  PUBSUB_TOPIC_MISC,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
} from '../../../constant';
import type { SupportedPlusCurrency } from '../../../constant';
import { convertUSDPriceToCurrency } from '../../pricing';
import { getBookUserInfoFromWallet, getBookUserInfoFromLikerId } from '../likernft/book/user';
import { getStripeClient, getStripePromotionFromCode } from '../../stripe';
import { userCollection } from '../../firebase';
import publisher from '../../gcloudPub';

import {
  LIKER_PLUS_MONTHLY_PRICE_ID,
  LIKER_PLUS_YEARLY_PRICE_ID,
  LIKER_PLUS_PRODUCT_ID,
  LIKER_PLUS_TRIAL_CONVERSION_RATE,
} from '../../../../config/config';
import { getUserWithCivicLikerPropertiesByWallet } from '../users/getPublicInfo';
import { sendPlusSubscriptionSlackNotification } from '../../slack';
import { createAirtableSubscriptionPaymentRecord } from '../../airtable';
import { createFreeBookCartFromSubscription } from '../likernft/book/cart';
import { ValidationError } from '../../ValidationError';
import { checkUserNameValid, normalizeLikerId } from '../../ValidationHelper';
import logServerEvents from '../../logServerEvents';
import { updateIntercomUserAttributes, sendIntercomEvent } from '../../intercom';

function findStripeDefaultPayment(payments?: Stripe.ApiList<Stripe.InvoicePayment>) {
  return payments?.data?.find((p) => p.is_default);
}

export async function processStripeSubscriptionInvoice(
  invoice: Stripe.Invoice,
  req: Express.Request,
) {
  const {
    billing_reason: billingReason,
    parent,
  } = invoice;
  const subscriptionDetails = parent?.type === 'subscription_details' ? parent.subscription_details : null;
  const subscriptionId = subscriptionDetails?.subscription as string;
  if (!subscriptionId) {
    // eslint-disable-next-line no-console
    console.warn(`No subscription ID found in invoice parent: ${invoice.id}`);
    return;
  }
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
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
  const {
    start_date: startDate,
    items: { data: [item] },
    metadata: subscriptionMetadata,
    customer,
    status,
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
    utmContent,
    utmTerm,
    paymentId,
    isUpgradingPrice,
    userAgent,
    clientIp,
    fbClickId,
    gaClientId,
    gaSessionId,
    affiliateGiftOnTrial,
    affiliateFrom,
  } = subscriptionMetadata || {};
  const productId = item.price.product as string;
  if (productId !== LIKER_PLUS_PRODUCT_ID) {
    // eslint-disable-next-line no-console
    console.warn(`Unexpected product ID in stripe subscription: ${productId} ${subscription}`);
    return;
  }

  const isNewSubscription = !user.likerPlus || user.likerPlus.since !== startDate * 1000;
  const amountPaid = invoice.amount_paid / 100;
  const isTrial = status === 'trialing';
  const price = amountPaid;
  let balanceTxAmount: number | undefined;
  let balanceTxExchangeRate: number | undefined;
  if (amountPaid > 0) {
    try {
      let defaultPayment = findStripeDefaultPayment(invoice.payments);
      if (!defaultPayment) {
        const expandedInvoice = await stripe.invoices.retrieve(
          invoice.id,
          { expand: ['payments.data'] },
        );
        defaultPayment = findStripeDefaultPayment(expandedInvoice.payments);
      }
      const paymentIntent = defaultPayment?.payment?.payment_intent;
      if (paymentIntent) {
        const paymentIntentId = typeof paymentIntent === 'string'
          ? paymentIntent : paymentIntent.id;
        const paymentIntentObj = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS },
        );
        const { latest_charge: latestCharge } = paymentIntentObj;
        if (latestCharge && typeof latestCharge !== 'string') {
          const { balance_transaction: balanceTx } = latestCharge;
          if (balanceTx && typeof balanceTx !== 'string') {
            balanceTxAmount = balanceTx.amount / 100;
            if (balanceTx.exchange_rate != null) {
              balanceTxExchangeRate = balanceTx.exchange_rate;
            }
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Error retrieving balance transaction for invoice ${invoice.id} of subscription ${subscriptionId}:`, err);
    }
  }
  const priceName = item.price.nickname || '';
  const currency = invoice.currency.toUpperCase();
  const priceWithCurrency = `${price.toFixed(2)} ${currency}`;
  const isSubscriptionCreation = billingReason === 'subscription_create';
  const isYearlySubscription = item.plan.interval === 'year';

  let giftCartId = '';
  const isTrialToPaidUpgrade = subscription.trial_end
    && subscription.trial_end === item.current_period_start;
  const isAffiliateGiftOnTrial = affiliateGiftOnTrial === 'true';
  const canCreateGiftCart = (!isTrial && amountPaid > 0)
    || (isAffiliateGiftOnTrial && isSubscriptionCreation);
  if ((isSubscriptionCreation || isTrialToPaidUpgrade || isUpgradingPrice)
      && isYearlySubscription
      && giftClassId
      && !existingGiftCartId
      && canCreateGiftCart) {
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
        isTrialGift: isAffiliateGiftOnTrial && isTrial,
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
  const currentPeriodStart = item.current_period_start * 1000; // Convert to milliseconds
  const currentPeriodEnd = item.current_period_end * 1000; // Convert to milliseconds
  const userUpdate: Record<string, unknown> = {
    likerPlus: {
      period,
      since,
      currentPeriodStart,
      currentPeriodEnd,
      currentType: isTrial ? 'trial' : 'paid',
      subscriptionId,
      customerId,
      subscriptionStatus: 'active',
    },
  };
  if (isSubscriptionCreation && affiliateFrom) {
    userUpdate.plusAffiliateFrom = normalizeLikerId(affiliateFrom);
  }
  await userCollection.doc(likerId).update(userUpdate);

  await updateIntercomUserAttributes(likerId, {
    is_liker_plus: true,
    is_liker_plus_trial: isTrial,
  });

  if (isSubscriptionCreation) {
    await sendIntercomEvent({
      userId: likerId,
      eventName: isTrial ? 'plus_trial_start' : 'plus_subscription_start',
    });
  } else if (isTrialToPaidUpgrade) {
    await sendIntercomEvent({
      userId: likerId,
      eventName: 'plus_trial_end',
    });
    await sendIntercomEvent({
      userId: likerId,
      eventName: 'plus_subscription_start',
    });
  }

  // Trial to paid upgrade is handled in processStripeSubscriptionUpdate
  if (isSubscriptionCreation || isTrialToPaidUpgrade) {
    const trialConversionRate = LIKER_PLUS_TRIAL_CONVERSION_RATE || 0.2;
    const predictedLTV = isTrial ? 120 * trialConversionRate : 120;
    await logServerEvents(isTrial ? 'StartTrial' : 'Subscribe', {
      email: user.email || stripeCustomer.email || undefined,
      items: [{
        productId: `plus-${period}ly`,
        quantity: 1,
      }],
      value: amountPaid,
      currency,
      userAgent,
      clientIp,
      fbClickId,
      paymentId,
      evmWallet,
      predictedLTV,
      gaClientId,
      gaSessionId,
      extraProperties: {
        subscription_id: subscriptionId,
        period,
        price_id: item.price.id,
      },
    });
  } else if (billingReason === 'subscription_cycle' && amountPaid > 0) {
    await logServerEvents('SubscriptionRenewed', {
      evmWallet,
      email: user.email || stripeCustomer.email || undefined,
      value: amountPaid,
      currency,
      paymentId: invoice.id,
      items: [{
        productId: `plus-${period}ly`,
        quantity: 1,
      }],
      extraProperties: {
        subscription_id: subscriptionId,
        period,
        price_id: item.price.id,
      },
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
      isTrial,
    }),
    createAirtableSubscriptionPaymentRecord({
      subscriptionId,
      customerId,
      customerEmail: user.email || '',
      customerUserId: likerId,
      customerWallet: user.evmWallet || '',
      productId,
      priceId: item.price.id,
      priceName,
      price,
      currency,
      balanceTxAmount,
      balanceTxExchangeRate,
      invoiceId: invoice.id,
      since,
      periodInterval: period,
      periodStartAt: currentPeriodStart,
      periodEndAt: currentPeriodEnd,
      isNew: isNewSubscription,
      isTrial,
      channel: from,
      utmCampaign,
      utmMedium,
      utmSource,
      utmContent,
      utmTerm,
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
    utmContent,
    utmTerm,
  });
}

export async function createNewPlusCheckoutSession(
  {
    period,
    trialPeriodDays = 0,
    mustCollectPaymentMethod = true,
    giftClassId,
    giftPriceIndex,
    coupon,
    currency,
    isApp,
  }: {
    period: 'monthly' | 'yearly',
    trialPeriodDays?: number,
    mustCollectPaymentMethod?: boolean,
    giftClassId?: string,
    giftPriceIndex?: string,
    coupon?: string,
    currency?: SupportedPlusCurrency,
    isApp?: boolean,
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
      if (bookUserInfo) {
        customerId = bookUserInfo.stripeCustomerId;
      }
    }
  }
  const subscriptionMetadata: Stripe.MetadataParam = {
    store: 'plus',
  };
  if (likeWallet) subscriptionMetadata.likeWallet = likeWallet;
  if (evmWallet) subscriptionMetadata.evmWallet = evmWallet;
  if (from) subscriptionMetadata.from = from;
  if (paymentId) subscriptionMetadata.paymentId = paymentId;

  // Require the `@` prefix so plain UTM/channel values don't trigger affiliate lookups.
  let resolvedGiftClassId = giftClassId;
  let resolvedGiftPriceIndex = giftPriceIndex;
  if (from && from.startsWith('@')) {
    try {
      const normalizedFrom = normalizeLikerId(from);
      if (checkUserNameValid(normalizedFrom)) {
        const affiliateUserInfo = await getBookUserInfoFromLikerId(normalizedFrom);
        const affiliateConfig = affiliateUserInfo?.wallet
          && affiliateUserInfo.bookUserInfo?.affiliateConfig?.active
          ? affiliateUserInfo.bookUserInfo.affiliateConfig
          : null;
        if (affiliateConfig) {
          subscriptionMetadata.affiliateFrom = from;
          if (!giftClassId && affiliateConfig.giftClassId && period === 'yearly') {
            resolvedGiftClassId = affiliateConfig.giftClassId;
            resolvedGiftPriceIndex = String(affiliateConfig.giftPriceIndex || 0);
            subscriptionMetadata.affiliateGiftOnTrial = affiliateConfig.giftOnTrial ? 'true' : 'false';
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Error resolving affiliate config for from:', from, err);
    }
  }

  if (resolvedGiftClassId) subscriptionMetadata.giftClassId = resolvedGiftClassId;
  if (resolvedGiftPriceIndex !== undefined) {
    subscriptionMetadata.giftPriceIndex = resolvedGiftPriceIndex;
  }
  if (utm?.campaign) subscriptionMetadata.utmCampaign = utm.campaign;
  if (utm?.source) subscriptionMetadata.utmSource = utm.source;
  if (utm?.medium) subscriptionMetadata.utmMedium = utm.medium;
  if (utm?.content) subscriptionMetadata.utmContent = utm.content;
  if (utm?.term) subscriptionMetadata.utmTerm = utm.term;
  if (userAgent) subscriptionMetadata.userAgent = userAgent;
  if (clientIp) subscriptionMetadata.clientIp = clientIp;
  if (fbClickId) subscriptionMetadata.fbClickId = fbClickId;
  if (gaClientId) subscriptionMetadata.gaClientId = gaClientId;
  if (gaSessionId) subscriptionMetadata.gaSessionId = gaSessionId;
  const metadata: Stripe.MetadataParam = { ...subscriptionMetadata };
  if (gadClickId) metadata.gadClickId = gadClickId;
  if (gadSource) metadata.gadSource = gadSource;
  if (referrer) metadata.referrer = referrer.substring(0, 500);

  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: subscriptionMetadata,
  };
  const hasFreeTrial = trialPeriodDays > 0;
  const isPaidTrial = trialPeriodDays >= PLUS_PAID_TRIAL_PERIOD_DAYS_THRESHOLD;
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

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID,
      quantity: 1,
    },
  ];

  const checkoutCurrency = currency || 'usd';
  // Add $1 one-time charge if isPaidTrial
  if (isPaidTrial) {
    const trialPriceInCurrency = convertUSDPriceToCurrency(PLUS_PAID_TRIAL_PRICE, checkoutCurrency);
    lineItems.push({
      price_data: {
        currency: checkoutCurrency,
        product_data: {
          name: '3ook.com Plus (Trial)',
        },
        unit_amount: trialPriceInCurrency * 100,
      },
      quantity: 1,
    } as Stripe.Checkout.SessionCreateParams.LineItem);
  }

  const payload: Stripe.Checkout.SessionCreateParams = {
    billing_address_collection: 'auto',
    line_items: lineItems,
    metadata,
    mode: 'subscription',
    subscription_data: subscriptionData,
    currency: checkoutCurrency,
    success_url: getPlusSuccessPageURL({
      period,
      paymentId,
      hasFreeTrial,
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
    cancel_url: getPlusPageURL({
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
    payment_method_collection: mustCollectPaymentMethod ? 'always' : 'if_required',
  };
  if (discounts.length) {
    payload.discounts = discounts;
  } else if (!isApp) {
    payload.allow_promotion_codes = true;
  }
  if (customerId) {
    payload.customer = customerId;
  } else {
    payload.customer_email = userEmail;
  }
  const session = await getStripeClient().checkout.sessions.create(payload);
  return {
    session,
    paymentId,
    email: userEmail,
  };
}

export async function processStripeSubscriptionCancellation(
  subscription: Stripe.Subscription,
) {
  const subscriptionId = subscription.id;
  const {
    evmWallet,
    likeWallet,
  } = subscription.metadata || {};
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
  const isTrialEnd = subscription.trial_end && subscription.cancel_at === subscription.trial_end;
  if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    const currentPeriodEnd = user.likerPlus?.currentPeriodEnd;
    if (currentPeriodEnd && currentPeriodEnd > Date.now()) {
      await userCollection.doc(likerId).update({
        likerPlus: {
          ...user.likerPlus,
          currentPeriodEnd: Date.now(),
          subscriptionStatus: 'canceled',
        },
      });
    }

    await updateIntercomUserAttributes(likerId, {
      is_liker_plus: false,
      is_liker_plus_trial: false,
    });

    const subscriptionItem = subscription.items?.data[0];
    const period = subscriptionItem?.plan?.interval;
    const priceId = subscriptionItem?.price?.id;
    const cancellationExtraProperties = {
      subscription_id: subscriptionId,
      period,
      price_id: priceId,
      cancel_reason: subscription.cancellation_details?.reason,
      cancel_feedback: subscription.cancellation_details?.feedback,
      cancel_comment: subscription.cancellation_details?.comment?.substring(0, 500),
    };
    if (isTrialEnd) {
      await Promise.all([
        sendIntercomEvent({
          userId: likerId,
          eventName: 'plus_trial_end',
        }),
        logServerEvents('TrialEnded', {
          evmWallet,
          paymentId: subscriptionId,
          extraProperties: cancellationExtraProperties,
        }),
      ]);
    } else {
      await Promise.all([
        sendIntercomEvent({
          userId: likerId,
          eventName: 'plus_subscription_end',
        }),
        logServerEvents('SubscriptionCancelled', {
          evmWallet,
          paymentId: subscriptionId,
          extraProperties: cancellationExtraProperties,
        }),
      ]);
    }
  }
}

export async function processStripePaymentFailure(
  invoice: Stripe.Invoice,
) {
  const subscriptionDetails = invoice.parent?.type === 'subscription_details'
    ? invoice.parent.subscription_details : null;
  const subscriptionId = subscriptionDetails?.subscription as string;
  if (!subscriptionId) return;
  const { evmWallet } = subscriptionDetails?.metadata || {};
  if (!evmWallet) return;
  const lastError = invoice.last_finalization_error;
  const value = (invoice.amount_remaining ?? invoice.amount_due ?? 0) / 100;
  const stripe = getStripeClient();
  const [subscription, user] = await Promise.all([
    stripe.subscriptions.retrieve(subscriptionId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Failed to retrieve subscription ${subscriptionId} for PaymentFailed event:`, err);
      return null;
    }),
    getUserWithCivicLikerPropertiesByWallet(evmWallet),
  ]);
  const subscriptionItem = subscription?.items?.data[0];
  const logPromise = logServerEvents('PaymentFailed', {
    evmWallet,
    paymentId: invoice.id,
    value,
    currency: invoice.currency?.toUpperCase(),
    extraProperties: {
      subscription_id: subscriptionId,
      period: subscriptionItem?.plan?.interval,
      price_id: subscriptionItem?.price?.id,
      attempt_count: invoice.attempt_count,
      failure_code: lastError?.code,
      failure_type: lastError?.type,
    },
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to log PaymentFailed event:', err);
  });
  if (user) {
    await userCollection.doc(user.user).update({
      'likerPlus.subscriptionStatus': 'past_due',
    });
  }
  await logPromise;
}

const STRIPE_TO_SUBSCRIPTION_STATUS: Partial<Record<
  Stripe.Subscription.Status, LikerPlusSubscriptionStatus
>> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'canceled',
  incomplete_expired: 'canceled',
};

export async function processStripeSubscriptionStatusUpdate(
  subscription: Stripe.Subscription,
) {
  const { status } = subscription;
  const { evmWallet, likeWallet } = subscription.metadata || {};
  if (!evmWallet && !likeWallet) {
    // eslint-disable-next-line no-console
    console.warn(`Subscription ${subscription.id} has no wallet in metadata`);
    return;
  }
  const subscriptionStatus = STRIPE_TO_SUBSCRIPTION_STATUS[status];
  if (!subscriptionStatus) {
    // eslint-disable-next-line no-console
    console.warn(`Unhandled Stripe subscription status ${status} for subscription ${subscription.id}`, {
      evmWallet,
      likeWallet,
    });
    return;
  }
  const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet || likeWallet);
  if (!user) return;
  if (user.likerPlus?.subscriptionStatus === subscriptionStatus) return;
  await userCollection.doc(user.user).update({
    'likerPlus.subscriptionStatus': subscriptionStatus,
  });
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
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const { metadata } = subscription;
  if (giftClassId) metadata.giftClassId = giftClassId;
  if (giftPriceIndex) metadata.giftPriceIndex = giftPriceIndex;
  if (period === 'yearly') metadata.isUpgradingPrice = 'true';
  const updatePayload: Stripe.SubscriptionUpdateParams = {
    items: [
      {
        id: subscription.items.data[0].id,
        price: period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID,
      },
    ],
    metadata,
  };
  const isInTrial = subscription.status === 'trialing';
  if (isInTrial) {
    updatePayload.trial_end = 'now';
    updatePayload.proration_behavior = 'none';
    updatePayload.billing_cycle_anchor = 'now';
  }
  await stripe.subscriptions.update(
    subscriptionId,
    updatePayload,
  );
}
