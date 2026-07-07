import type Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import type { LikerPlusSubscriptionStatus, UserCivicLikerProperties } from '../../../types/user';

import { getPlusPageURL, getPlusSuccessPageURL } from '../../liker-land';
import {
  PLUS_PAID_TRIAL_PERIOD_DAYS_THRESHOLD,
  PLUS_PAID_TRIAL_PRICE,
  PUBSUB_TOPIC_MISC,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  SUPPORTED_PLUS_CURRENCIES,
} from '../../../constant';
import type { SupportedCheckoutUIMode, SupportedPlusCurrency } from '../../../constant';
import { convertCurrencyToUSDPrice, convertUSDPriceToCurrency } from '../../pricing';
import { getBookUserInfoFromWallet, getBookUserInfoFromLikerId } from '../likernft/book/user';
import { getStripeClient, getStripePromotionFromCode } from '../../stripe';
import { userCollection } from '../../firebase';
import { getCustomerType, getPaymentUpdateFields } from '../users/payment';
import publisher from '../../gcloudPub';

import {
  LIKER_PLUS_MONTHLY_PRICE_ID,
  LIKER_PLUS_YEARLY_PRICE_ID,
  LIKER_PLUS_PRODUCT_ID,
  LIKER_PLUS_TRIAL_CONVERSION_RATE,
  LIKER_PLUS_LTV,
} from '../../../../config/config';
import { getUserWithCivicLikerPropertiesByWallet } from '../users/getPublicInfo';
import { calculatePlusDailyValue, recordPlusSubscriptionAccrual } from './revenueShare';
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

function getCouponFromDiscounts(
  discounts?: Array<string | Stripe.Discount | Stripe.DeletedDiscount> | null,
): Stripe.Coupon | undefined {
  const discount = discounts?.find(
    (d): d is Stripe.Discount | Stripe.DeletedDiscount => typeof d !== 'string',
  );
  const coupon = discount?.source?.coupon;
  return coupon && typeof coupon !== 'string' ? coupon : undefined;
}

// Resolve the gift book attached to a subscription from an affiliate `from`
// handle. Shared by the Stripe checkout (createNewPlusCheckoutSession) and the
// RevenueCat IAP grant handler (revenuecat.ts) so both resolve identically. A
// non-affiliate `giftClassId` (the upsell "subscribe to get this book" flow)
// passes through untouched. Gift books only attach to yearly plans; for affiliate
// gifts, the priceIndex comes from the affiliate config (never the client) since
// the gift is free.
export async function resolveAffiliateGift({
  from,
  giftClassId,
  giftPriceIndex,
  period,
}: {
  from?: string;
  giftClassId?: string;
  giftPriceIndex?: string;
  period: 'monthly' | 'yearly';
}): Promise<{
  giftClassId?: string;
  giftPriceIndex?: string;
  affiliateFrom?: string;
  affiliateGiftOnTrial?: boolean;
}> {
  const result: {
    giftClassId?: string;
    giftPriceIndex?: string;
    affiliateFrom?: string;
    affiliateGiftOnTrial?: boolean;
  } = { giftClassId, giftPriceIndex };
  // Require the `@` prefix so plain UTM/channel values don't trigger affiliate lookups.
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
          result.affiliateFrom = from;
          const giftBooks = affiliateConfig.giftBooks || [];
          if (giftBooks.length && period === 'yearly') {
            // No pick defaults to the first book so plain affiliate links still
            // grant a gift. An explicit `giftClassId` outside the list stays
            // untouched, keeping the non-affiliate gift flow (upsell
            // "subscribe to get this book") working.
            const chosen = giftClassId
              ? giftBooks.find((b) => b.classId === giftClassId)
              : giftBooks[0];
            if (chosen) {
              result.giftClassId = chosen.classId;
              result.giftPriceIndex = String(chosen.priceIndex || 0);
              result.affiliateGiftOnTrial = !!affiliateConfig.giftOnTrial;
            }
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Error resolving affiliate config for from:', from, err);
    }
  }
  return result;
}

export function mapAttributionExtraProperties({
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  utmTerm,
  from,
}: {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  from?: string;
}) {
  return {
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    utm_term: utmTerm,
    channel: from,
  };
}

// Predicted LTV in `currency` for Plus acquisition events; trials are discounted
// by the expected trial→paid rate. Shared by the Stripe and IAP paths so both
// report the same value signal (IAP trials charge 0 and would otherwise send 0).
export function getPlusPredictedLTV(
  isTrial: boolean,
  currency?: string,
): { value: number; currency: SupportedPlusCurrency } {
  const ltvUSD = LIKER_PLUS_LTV || 100;
  const predictedLTVUSD = isTrial ? ltvUSD * (LIKER_PLUS_TRIAL_CONVERSION_RATE || 0.5) : ltvUSD;
  // convertUSDPriceToCurrency only knows Plus currencies and silently returns USD
  // for the rest; normalize so the returned currency always matches the value.
  const normalized = (currency || 'usd').toLowerCase();
  const ltvCurrency: SupportedPlusCurrency = (SUPPORTED_PLUS_CURRENCIES as readonly string[])
    .includes(normalized) ? (normalized as SupportedPlusCurrency) : 'usd';
  return {
    value: convertUSDPriceToCurrency(predictedLTVUSD, ltvCurrency),
    currency: ltvCurrency,
  };
}

interface PlusInvoiceContext {
  subscriptionId: string;
  evmWallet?: string;
  likeWallet?: string;
  user: UserCivicLikerProperties;
  likerId: string;
  subscription: Stripe.Subscription;
  stripeCustomer: Stripe.Customer;
  item: Stripe.SubscriptionItem;
  subscriptionMetadata: Stripe.Metadata;
  startDate: number;
  status: Stripe.Subscription.Status;
  productId: string;
}

// Resolve everything the invoice webhook needs to process a Plus subscription
// charge; warns and returns null for unprocessable invoices (no subscription,
// no wallet in metadata, unknown user, or a non-Plus product).
async function resolvePlusInvoiceContext(
  invoice: Stripe.Invoice,
): Promise<PlusInvoiceContext | null> {
  const { parent } = invoice;
  const subscriptionDetails = parent?.type === 'subscription_details' ? parent.subscription_details : null;
  const subscriptionId = subscriptionDetails?.subscription as string;
  if (!subscriptionId) {
    // eslint-disable-next-line no-console
    console.warn(`No subscription ID found in invoice parent: ${invoice.id}`);
    return null;
  }
  const {
    evmWallet,
    likeWallet,
  } = subscriptionDetails?.metadata || {};
  if (!evmWallet && !likeWallet) {
    // eslint-disable-next-line no-console
    console.warn(`No evmWallet or likeWallet found in subscription: ${subscriptionId}`);
    return null;
  }
  const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet || likeWallet);
  if (!user) {
    // eslint-disable-next-line no-console
    console.warn(`No likerId found for evmWallet: ${evmWallet}, likeWallet: ${likeWallet}, subscription: ${subscriptionId}`);
    return null;
  }
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer', 'discounts.source.coupon'] });
  const {
    start_date: startDate,
    items: { data: [item] },
    metadata: subscriptionMetadata,
    customer,
    status,
  } = subscription;
  const productId = item.price.product as string;
  if (productId !== LIKER_PLUS_PRODUCT_ID) {
    // eslint-disable-next-line no-console
    console.warn(`Unexpected product ID in stripe subscription: ${productId} ${subscription}`);
    return null;
  }
  return {
    subscriptionId,
    evmWallet,
    likeWallet,
    user,
    likerId: user.user,
    subscription,
    stripeCustomer: customer as Stripe.Customer,
    item,
    subscriptionMetadata: subscriptionMetadata || {},
    startDate,
    status,
    productId,
  };
}

// Fetch the paid charge's balance transaction (real USD settlement) and the
// applied coupon. One helper on purpose: both lookups reuse the same expanded
// invoice fetch. Both are best-effort and return undefined on Stripe errors.
async function fetchInvoicePaymentDetails({
  invoice,
  subscriptionId,
  subscriptionDiscounts,
}: {
  invoice: Stripe.Invoice;
  subscriptionId: string;
  subscriptionDiscounts: Stripe.Subscription['discounts'];
}): Promise<{
  balanceTxAmount?: number;
  balanceTxExchangeRate?: number;
  coupon?: Stripe.Coupon;
}> {
  const stripe = getStripeClient();
  let balanceTxAmount: number | undefined;
  let balanceTxExchangeRate: number | undefined;
  let expandedInvoice: Stripe.Invoice | undefined;
  if (invoice.amount_paid > 0) {
    try {
      let defaultPayment = findStripeDefaultPayment(invoice.payments);
      if (!defaultPayment) {
        expandedInvoice = await stripe.invoices.retrieve(
          invoice.id,
          { expand: ['payments.data', 'discounts.source.coupon'] },
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
  // Prefer the invoice's own discounts (immutable, correct for `once`/expired
  // coupons that Stripe removes from the subscription after applying them);
  // fall back to the subscription-level discount.
  let coupon: Stripe.Coupon | undefined;
  try {
    if (!expandedInvoice) {
      expandedInvoice = await stripe.invoices.retrieve(
        invoice.id,
        { expand: ['discounts.source.coupon'] },
      );
    }
    coupon = getCouponFromDiscounts(expandedInvoice.discounts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Error retrieving invoice discounts for invoice ${invoice.id}:`, err);
  }
  if (!coupon) coupon = getCouponFromDiscounts(subscriptionDiscounts);
  return { balanceTxAmount, balanceTxExchangeRate, coupon };
}

// Create the gift book cart for a yearly subscription and persist its pointers
// into the subscription metadata. Returns the new cart id, or '' when creation
// failed (metadata reverted so a later invoice can retry). Whether a gift cart
// is due at all is decided by the caller.
async function maybeCreateSubscriptionGiftCart({
  subscriptionId,
  giftClassId,
  giftPriceIndex,
  isUpgradingPrice,
  amountPaid,
  isTrialGift,
  evmWallet,
  email,
}: {
  subscriptionId: string;
  giftClassId: string;
  giftPriceIndex: string;
  isUpgradingPrice?: string;
  amountPaid: number;
  isTrialGift: boolean;
  evmWallet?: string;
  email: string | null;
}): Promise<string> {
  const stripe = getStripeClient();
  // Best-effort: drop the giftCartId pointer written before cart creation and
  // restore isUpgradingPrice, so a later invoice can retry the gift cart.
  const revertGiftCartMetadata = async () => {
    try {
      await stripe.subscriptions.update(subscriptionId, {
        metadata: {
          giftCartId: '',
          ...(isUpgradingPrice ? { isUpgradingPrice } : {}),
        },
      });
    } catch (revertError) {
      // eslint-disable-next-line no-console
      console.error(`Failed to revert gift cart metadata for subscription ${subscriptionId}:`, revertError);
    }
  };
  let giftCartId = '';
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
      isTrialGift,
    }, {
      evmWallet,
      email,
    });
    if (result) {
      const {
        cartId,
        paymentId: giftPaymentId,
        claimToken,
      } = result;
      // Best-effort: the cart already exists, so a failure persisting payment
      // pointers must not fall into the outer catch and revert giftCartId,
      // which would orphan the cart and let a later invoice duplicate it.
      try {
        // Don't respread subscriptionMetadata here; merging per-key keeps the
        // isUpgradingPrice key cleared above from being restored.
        await stripe.subscriptions.update(subscriptionId, {
          metadata: {
            giftClassId,
            giftCartId: cartId,
            giftPaymentId,
            giftClaimToken: claimToken,
          },
        });
      } catch (metadataError) {
        // eslint-disable-next-line no-console
        console.error(`Failed to persist gift cart payment metadata for subscription ${subscriptionId}:`, metadataError);
      }
    } else {
      giftCartId = '';
      await revertGiftCartMetadata();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error creating gift cart from subscription:', error);
    giftCartId = '';
    await revertGiftCartMetadata();
  }
  return giftCartId;
}

// Write the user's likerPlus record (plus payment/affiliate fields) and accrue
// this term's USD value to the rev-share pool.
async function writePlusUserRecordAndAccrual({
  ctx,
  since,
  currentPeriodStart,
  currentPeriodEnd,
  isTrial,
  isFullTermInvoice,
  isSubscriptionCreation,
  amountPaid,
  amountPaidUSD,
  currency,
}: {
  ctx: PlusInvoiceContext;
  since: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  isTrial: boolean;
  isFullTermInvoice: boolean;
  isSubscriptionCreation: boolean;
  amountPaid: number;
  amountPaidUSD: number;
  currency: string;
}): Promise<void> {
  const {
    user,
    likerId,
    subscriptionId,
    stripeCustomer,
    item,
    subscriptionMetadata,
  } = ctx;
  const { affiliateFrom } = subscriptionMetadata;
  const dailyValue = isFullTermInvoice
    ? calculatePlusDailyValue({
      amountPaid: isTrial ? 0 : amountPaid,
      currentPeriodStart,
      currentPeriodEnd,
    })
    : (user.likerPlus?.dailyValue ?? 0);
  const dailyValueCurrency = isFullTermInvoice
    ? currency
    : (user.likerPlus?.dailyValueCurrency ?? currency);
  const userUpdate: Record<string, unknown> = {
    likerPlus: {
      period: item.plan.interval,
      since,
      currentPeriodStart,
      currentPeriodEnd,
      currentType: isTrial ? 'trial' : 'paid',
      dailyValue,
      dailyValueCurrency,
      subscriptionId,
      customerId: stripeCustomer.id,
      subscriptionStatus: 'active',
      provider: 'stripe',
    },
  };
  if (isSubscriptionCreation && affiliateFrom) {
    userUpdate.plusAffiliateFrom = normalizeLikerId(affiliateFrom);
  }
  if (amountPaid > 0) {
    Object.assign(userUpdate, getPaymentUpdateFields(!!user.firstPaidAt));
  }
  await userCollection.doc(likerId).update(userUpdate);

  // Accrue this term's USD value to the rev-share pool. Full-term paid charges only:
  // proration invoices reuse the stored dailyValue (already accrued at the cycle), and
  // trials fund nothing. The charge is normalized from its invoice currency to USD so
  // the pool stays single-currency.
  if (isFullTermInvoice && !isTrial && dailyValue > 0) {
    const dailyValueUSD = calculatePlusDailyValue({
      amountPaid: amountPaidUSD,
      currentPeriodStart,
      currentPeriodEnd,
    });
    // Best-effort: accrual is not yet used for payouts, so a transient Firestore
    // failure must not fail (and make Stripe retry) the subscription webhook.
    try {
      await recordPlusSubscriptionAccrual({
        likerId,
        subscriptionId,
        dailyValueUSD,
        currency,
        currentPeriodStart,
        currentPeriodEnd,
        provider: 'stripe',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Error recording Plus reading accrual for ${likerId}:`, err);
    }
  }
}

// Emit every post-write notification for a processed subscription invoice:
// Intercom attributes/events, acquisition or renewal analytics, Slack,
// Airtable, and the PubSub log. The awaits are deliberately sequential, and
// failures propagate so the Stripe webhook retries.
async function emitPlusInvoiceAnalytics({
  req,
  invoice,
  ctx,
  isTrial,
  isNewSubscription,
  isTrialToPaidUpgrade,
  amountPaid,
  amountPaidUSD,
  currency,
  coupon,
  balanceTxAmount,
  balanceTxExchangeRate,
  since,
  currentPeriodStart,
  currentPeriodEnd,
  giftCartId,
}: {
  req: Express.Request;
  invoice: Stripe.Invoice;
  ctx: PlusInvoiceContext;
  isTrial: boolean;
  isNewSubscription: boolean;
  isTrialToPaidUpgrade: boolean;
  amountPaid: number;
  amountPaidUSD: number;
  currency: string;
  coupon?: Stripe.Coupon;
  balanceTxAmount?: number;
  balanceTxExchangeRate?: number;
  since: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  giftCartId: string;
}) {
  const {
    user,
    likerId,
    subscriptionId,
    stripeCustomer,
    item,
    productId,
    subscriptionMetadata,
    evmWallet,
    likeWallet,
  } = ctx;
  const {
    from,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
    paymentId,
    userAgent,
    clientIp,
    fbClickId,
    fbp,
    fbc,
    gaClientId,
    gaSessionId,
    referrer,
  } = subscriptionMetadata;
  const { billing_reason: billingReason } = invoice;
  const isSubscriptionCreation = billingReason === 'subscription_create';
  const customerId = stripeCustomer.id;
  const period = item.plan.interval;
  const priceWithCurrency = `${amountPaid.toFixed(2)} ${currency}`;

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
    const { value: predictedLTV } = getPlusPredictedLTV(isTrial, currency);
    // Shared payload for the Subscribe/StartTrial and PlusAcquisition events; they must
    // carry identical attribution and value so the browser pixel can dedup against them.
    const acquisitionEventPayload = {
      email: user.email || stripeCustomer.email || undefined,
      items: [{
        productId: `plus-${period}ly`,
        quantity: 1,
      }],
      value: isTrial ? predictedLTV : amountPaid,
      currency,
      userAgent,
      clientIp,
      fbClickId,
      fbp,
      fbc,
      paymentId,
      evmWallet,
      predictedLTV,
      gaClientId,
      gaSessionId,
      customerType: isNewSubscription ? getCustomerType(user) : 'returning',
      extraProperties: {
        subscription_id: subscriptionId,
        provider: 'stripe',
        platform: 'web',
        period,
        price_id: item.price.id,
        product_id: productId,
        ...mapAttributionExtraProperties({
          utmSource, utmMedium, utmCampaign, utmContent, utmTerm, from,
        }),
        $referrer: referrer,
      },
      setOnce: referrer ? { $initial_referrer: referrer } : undefined,
    };
    // Independent analytics emits — fire in parallel (matches the renewal/Airtable paths).
    const events = [logServerEvents(isTrial ? 'StartTrial' : 'Subscribe', acquisitionEventPayload)];
    // Unified acquisition event — fired once per new subscription (creation only,
    // NOT on trial→paid upgrade) so it counts each subscription exactly once. This is
    // the single signal to optimize Meta on; mirrored by the browser pixel.
    if (isSubscriptionCreation) {
      events.push(logServerEvents('PlusAcquisition', {
        ...acquisitionEventPayload,
        extraProperties: { ...acquisitionEventPayload.extraProperties, is_trial: isTrial },
      }));
    }
    await Promise.all(events);
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
      userAgent,
      clientIp,
      fbClickId,
      fbp,
      fbc,
      gaClientId,
      gaSessionId,
      customerType: 'returning',
      extraProperties: {
        subscription_id: subscriptionId,
        period,
        price_id: item.price.id,
        ...mapAttributionExtraProperties({
          utmSource, utmMedium, utmCampaign, utmContent, utmTerm, from,
        }),
      },
    });
  }

  await Promise.all([
    sendPlusSubscriptionSlackNotification({
      subscriptionId,
      email: user.email || 'N/A',
      priceWithCurrency,
      // Treat the first payment converted from a trial as a new subscription,
      // not a renewal (start_date is unchanged so isNewSubscription is false).
      isNew: isNewSubscription || isTrialToPaidUpgrade,
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
      priceName: item.price.nickname || '',
      price: amountPaid,
      currency,
      balanceTxAmount,
      balanceTxExchangeRate,
      invoiceId: invoice.id,
      couponId: coupon?.id || '',
      couponName: coupon?.name || '',
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
    period,
    price: amountPaid,
    amountUSD: amountPaidUSD,
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

export async function processStripeSubscriptionInvoice(
  invoice: Stripe.Invoice,
  req: Express.Request,
) {
  const { billing_reason: billingReason } = invoice;
  const ctx = await resolvePlusInvoiceContext(invoice);
  if (!ctx) return;
  const {
    subscriptionId,
    evmWallet,
    user,
    subscription,
    stripeCustomer,
    item,
    subscriptionMetadata,
    startDate,
    status,
  } = ctx;
  const {
    giftClassId,
    giftPriceIndex = '0',
    giftCartId: existingGiftCartId,
    isUpgradingPrice,
    affiliateGiftOnTrial,
  } = subscriptionMetadata;

  const since = startDate * 1000; // Convert to milliseconds
  const isNewSubscription = !user.likerPlus || user.likerPlus.since !== since;
  const amountPaid = invoice.amount_paid / 100;
  const isTrial = status === 'trialing';
  const {
    balanceTxAmount,
    balanceTxExchangeRate,
    coupon,
  } = await fetchInvoicePaymentDetails({
    invoice,
    subscriptionId,
    subscriptionDiscounts: subscription.discounts,
  });
  const currency = invoice.currency.toUpperCase();
  // Stripe settles in USD, so the charge's balance transaction amount is the real
  // converted USD value (actual FX, net of spread). Prefer it; fall back to tier-based
  // conversion only when the balance transaction couldn't be fetched.
  const amountPaidUSD = balanceTxAmount
    ?? convertCurrencyToUSDPrice(
      amountPaid,
      currency.toLowerCase() as SupportedPlusCurrency,
    );
  const isSubscriptionCreation = billingReason === 'subscription_create';
  const isYearlySubscription = item.plan.interval === 'year';

  const isTrialToPaidUpgrade = !!(subscription.trial_end
    && subscription.trial_end === item.current_period_start);
  const isAffiliateGiftOnTrial = affiliateGiftOnTrial === 'true';
  const canCreateGiftCart = (!isTrial && amountPaid > 0)
    || (isAffiliateGiftOnTrial && isSubscriptionCreation);
  let giftCartId = '';
  if ((isSubscriptionCreation || isTrialToPaidUpgrade || isUpgradingPrice)
      && isYearlySubscription
      && giftClassId
      && !existingGiftCartId
      && canCreateGiftCart) {
    giftCartId = await maybeCreateSubscriptionGiftCart({
      subscriptionId,
      giftClassId,
      giftPriceIndex,
      isUpgradingPrice,
      amountPaid,
      isTrialGift: isAffiliateGiftOnTrial && isTrial,
      evmWallet,
      email: stripeCustomer.email,
    });
  }

  const currentPeriodStart = item.current_period_start * 1000; // Convert to milliseconds
  const currentPeriodEnd = item.current_period_end * 1000; // Convert to milliseconds
  // A proration invoice pays a partial amount that doesn't match the full
  // current_period_start/end term, so dividing would understate per-day value;
  // recompute only for full-term charges, else preserve the stored value.
  const isFullTermInvoice = isSubscriptionCreation
    || isTrialToPaidUpgrade
    || billingReason === 'subscription_cycle';
  await writePlusUserRecordAndAccrual({
    ctx,
    since,
    currentPeriodStart,
    currentPeriodEnd,
    isTrial,
    isFullTermInvoice,
    isSubscriptionCreation,
    amountPaid,
    amountPaidUSD,
    currency,
  });

  await emitPlusInvoiceAnalytics({
    req,
    invoice,
    ctx,
    isTrial,
    isNewSubscription,
    isTrialToPaidUpgrade,
    amountPaid,
    amountPaidUSD,
    currency,
    coupon,
    balanceTxAmount,
    balanceTxExchangeRate,
    since,
    currentPeriodStart,
    currentPeriodEnd,
    giftCartId,
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
    uiMode = 'hosted',
  }: {
    period: 'monthly' | 'yearly',
    trialPeriodDays?: number,
    mustCollectPaymentMethod?: boolean,
    giftClassId?: string,
    giftPriceIndex?: string,
    coupon?: string,
    currency?: SupportedPlusCurrency,
    isApp?: boolean,
    uiMode?: SupportedCheckoutUIMode,
  },
  {
    from,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    fbp,
    fbc,
    referrer,
    userAgent,
    clientIp,
    ipCountry,
    utm,
  }: {
    from?: string,
    gaClientId?: string,
    gaSessionId?: string,
    gadClickId?: string,
    gadSource?: string,
    fbClickId?: string,
    fbp?: string,
    fbc?: string,
    referrer?: string,
    userAgent?: string,
    clientIp?: string,
    ipCountry?: string,
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
    user: appUserId,
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
  // Our internal user id is the RevenueCat app_user_id. Nothing reads it yet; it
  // lets a future RevenueCat Stripe integration map this web subscription to the
  // same identity the mobile app logs in with (see GET /plus/revenuecat/config).
  if (appUserId) subscriptionMetadata.appUserId = appUserId;
  if (from) subscriptionMetadata.from = from;
  if (paymentId) subscriptionMetadata.paymentId = paymentId;

  const {
    giftClassId: resolvedGiftClassId,
    giftPriceIndex: resolvedGiftPriceIndex,
    affiliateFrom,
    affiliateGiftOnTrial,
  } = await resolveAffiliateGift({
    from, giftClassId, giftPriceIndex, period,
  });
  if (affiliateFrom) subscriptionMetadata.affiliateFrom = affiliateFrom;
  if (affiliateGiftOnTrial !== undefined) {
    subscriptionMetadata.affiliateGiftOnTrial = affiliateGiftOnTrial ? 'true' : 'false';
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
  if (ipCountry) subscriptionMetadata.ipCountry = ipCountry;
  if (fbClickId) subscriptionMetadata.fbClickId = fbClickId;
  if (fbp) subscriptionMetadata.fbp = fbp.substring(0, 255);
  if (fbc) subscriptionMetadata.fbc = fbc.substring(0, 255);
  if (gaClientId) subscriptionMetadata.gaClientId = gaClientId;
  if (gaSessionId) subscriptionMetadata.gaSessionId = gaSessionId;
  if (referrer) subscriptionMetadata.referrer = referrer.substring(0, 500);
  const metadata: Stripe.MetadataParam = { ...subscriptionMetadata };
  if (gadClickId) metadata.gadClickId = gadClickId;
  if (gadSource) metadata.gadSource = gadSource;

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

  const successUrl = getPlusSuccessPageURL({
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
  });
  const payload: Stripe.Checkout.SessionCreateParams = {
    billing_address_collection: 'auto',
    line_items: lineItems,
    metadata,
    mode: 'subscription',
    subscription_data: subscriptionData,
    currency: checkoutCurrency,
    payment_method_collection: mustCollectPaymentMethod ? 'always' : 'if_required',
  };
  if (uiMode === 'embedded') {
    payload.ui_mode = 'embedded_page';
    payload.return_url = successUrl;
    payload.redirect_on_completion = 'if_required';
  } else {
    payload.success_url = successUrl;
    payload.cancel_url = getPlusPageURL({
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    });
  }
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
    from,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
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
      ...mapAttributionExtraProperties({
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm, from,
      }),
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
  const {
    evmWallet,
    from,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
    userAgent,
    clientIp,
    fbClickId,
    fbp,
    fbc,
    gaClientId,
    gaSessionId,
  } = subscriptionDetails?.metadata || {};
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
    userAgent,
    clientIp,
    fbClickId,
    fbp,
    fbc,
    gaClientId,
    gaSessionId,
    extraProperties: {
      subscription_id: subscriptionId,
      period: subscriptionItem?.plan?.interval,
      price_id: subscriptionItem?.price?.id,
      attempt_count: invoice.attempt_count,
      failure_code: lastError?.code,
      failure_type: lastError?.type,
      ...mapAttributionExtraProperties({
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm, from,
      }),
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
