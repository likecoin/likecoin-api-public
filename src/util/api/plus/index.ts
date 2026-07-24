import type Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import type { LikerPlusSubscriptionStatus, UserCivicLikerProperties } from '../../../types/user';

import { getPlusPageURL, getPlusSuccessPageURL, getPlusUpgradeSuccessPageURL } from '../../liker-land';
import {
  ONE_DAY_IN_MS,
  LIKER_PLUS_TIERS,
  PLUS_CIVIC_MONTHLY_PRICE,
  PLUS_CIVIC_YEARLY_PRICE,
  PLUS_MONTHLY_PRICE,
  PLUS_PAID_TRIAL_PERIOD_DAYS_THRESHOLD,
  PLUS_PAID_TRIAL_PRICE,
  PLUS_YEARLY_PRICE,
  PUBSUB_TOPIC_MISC,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  SUPPORTED_PLUS_CURRENCIES,
} from '../../../constant';
import type { LikerPlusTier, SupportedCheckoutUIMode, SupportedPlusCurrency } from '../../../constant';
import { convertCurrencyToUSDPrice, convertUSDPriceToCurrency } from '../../pricing';
import { getBookUserInfoFromWallet, getBookUserInfoFromLikerId } from '../likernft/book/user';
import { getStripeClient, resolveCheckoutDiscountsFromCoupon } from '../../stripe';
import {
  userCollection, FieldValue, Timestamp,
} from '../../firebase';
import { getCustomerType, getPaymentUpdateFields } from '../users/payment';
import publisher from '../../gcloudPub';

import {
  LIKER_PLUS_MONTHLY_PRICE_ID,
  LIKER_PLUS_YEARLY_PRICE_ID,
  LIKER_PLUS_PRODUCT_ID,
  LIKER_PLUS_CIVIC_MONTHLY_PRICE_ID,
  LIKER_PLUS_CIVIC_YEARLY_PRICE_ID,
  LIKER_PLUS_CIVIC_PRODUCT_ID,
  LIKER_PLUS_TRIAL_CONVERSION_RATE,
  LIKER_PLUS_LTV,
  LIKER_PLUS_UPGRADE_PORTAL_CONFIG_ID,
} from '../../../../config/config';
import { getUserWithCivicLikerPropertiesByWallet } from '../users/getPublicInfo';
import {
  extendSharedMemberAccess,
  isSharedGrantedLikerPlus,
  revokeSharedMemberAccess,
} from './sharedMember';
import { calculatePlusDailyValue, recordPlusSubscriptionAccrual } from './revenueShare';
import { sendPlusSubscriptionSlackNotification } from '../../slack';
import { createAirtableSubscriptionPaymentRecord } from '../../airtable';
import { createFreeBookCartFromSubscription } from '../likernft/book/cart';
import { ValidationError } from '../../ValidationError';
import { checkUserNameValid, normalizeLikerId } from '../../ValidationHelper';
import logServerEvents from '../../logServerEvents';
import { updateIntercomUserAttributes, sendIntercomEvent } from '../../intercom';

export type PlusPeriod = 'monthly' | 'yearly';

export function getPlusPriceId(tier: LikerPlusTier, period: PlusPeriod): string {
  if (tier === 'civic') {
    return period === 'yearly' ? LIKER_PLUS_CIVIC_YEARLY_PRICE_ID : LIKER_PLUS_CIVIC_MONTHLY_PRICE_ID;
  }
  return period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID;
}

// Map a Stripe product id to its Plus tier; null for non-Plus products. The
// non-empty guard on the Civic id keeps an unconfigured deployment (both ids
// '') from ever tier-matching a foreign product.
export function derivePlusTierFromProductId(productId?: string | null): LikerPlusTier | null {
  if (productId === LIKER_PLUS_PRODUCT_ID) return 'plus';
  if (LIKER_PLUS_CIVIC_PRODUCT_ID && productId === LIKER_PLUS_CIVIC_PRODUCT_ID) return 'civic';
  return null;
}

// Stripe bills in interval units ('month'/'year'); the API's public plan
// vocabulary is PlusPeriod ('monthly'/'yearly'). Convert at the boundary.
export function stripeIntervalToPlusPeriod(interval?: string): PlusPeriod {
  return interval === 'year' ? 'yearly' : 'monthly';
}

// LIKER_PLUS_TIERS is ordered lowest to highest; positive means a is above b.
export function comparePlusTiers(a: LikerPlusTier, b: LikerPlusTier): number {
  return LIKER_PLUS_TIERS.indexOf(a) - LIKER_PLUS_TIERS.indexOf(b);
}

// The Plus-tier USD price for a Stripe plan interval. Civic funds the reading
// rev-share pool at this rate instead of its own 10× price (flat rev-share,
// product decision). Do NOT refactor callers back to "derive from the charge".
export function getPlusEquivalentUSDPrice(interval?: string): number {
  return interval === 'year' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE;
}

// Sticker USD price of a tier/period pair, for analytics value signals.
export function getPlusTierUSDPrice(tier: LikerPlusTier, period: PlusPeriod): number {
  if (tier === 'civic') {
    return period === 'yearly' ? PLUS_CIVIC_YEARLY_PRICE : PLUS_CIVIC_MONTHLY_PRICE;
  }
  return period === 'yearly' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE;
}

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
  period: PlusPeriod;
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
  tier: LikerPlusTier;
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
  const tier = derivePlusTierFromProductId(productId);
  if (!tier) {
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
    tier,
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
  const isCivic = ctx.tier === 'civic';
  // Flat rev-share: Civic funds the pool at the Plus-tier USD price, so its
  // 10× sticker never inflates author payouts (see getPlusEquivalentUSDPrice).
  const fundingAmountPaid = isCivic
    ? getPlusEquivalentUSDPrice(item.plan.interval)
    : amountPaid;
  const dailyValue = isFullTermInvoice
    ? calculatePlusDailyValue({
      amountPaid: isTrial ? 0 : fundingAmountPaid,
      currentPeriodStart,
      currentPeriodEnd,
    })
    : (user.likerPlus?.dailyValue ?? 0);
  let dailyValueCurrency = user.likerPlus?.dailyValueCurrency ?? currency;
  if (isFullTermInvoice) {
    // Civic's pinned funding basis is a USD constant, whatever the invoice currency.
    dailyValueCurrency = isCivic ? 'USD' : currency;
  }
  const userUpdate: Record<string, unknown> = {
    likerPlus: {
      period: item.plan.interval,
      tier: ctx.tier,
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
      // Civic accrues at the Plus-equivalent rate (already USD), see above.
      amountPaid: isCivic ? fundingAmountPaid : amountPaidUSD,
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

  // Shared-membership seats follow the giver's Civic lifecycle: a Civic charge carries
  // claimed members into the new period; a Civic→Plus downgrade invoice revokes
  // them. Both helpers are best-effort and never fail the webhook.
  if (isCivic) {
    await extendSharedMemberAccess(likerId, { currentPeriodStart, currentPeriodEnd });
  } else if (user.likerPlus?.tier === 'civic') {
    await revokeSharedMemberAccess(likerId);
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
    tier,
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
    liker_plus_tier: tier,
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
        productId: `${tier}-${period}ly`,
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
        tier,
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
        productId: `${tier}-${period}ly`,
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
        tier,
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

// Stripe retries a webhook for up to ~3 days; keep the dedupe marker past that so
// late retries stay deduped, then let a Firestore TTL policy (on `expireAt`) purge
// it so the subcollection doesn't grow unbounded. Matches the plusUsageReceipts window.
const PROCESSED_INVOICE_TTL_MS = 7 * ONE_DAY_IN_MS;
// gRPC ALREADY_EXISTS: create() of an existing doc rejects with this code — how the
// idempotency gate detects a duplicate delivery (mirrors revenueShare.ts).
const GRPC_ALREADY_EXISTS = 6;

// Atomically claim an invoice's side effects, returning the claim doc ref only for
// the first caller (null if already claimed). The caller releases the claim if the
// emit fails so a Stripe retry can re-run the side effects instead of dropping them.
async function claimPlusInvoiceEmit({
  likerId,
  invoiceId,
  subscriptionId,
}: {
  likerId: string;
  invoiceId: string;
  subscriptionId: string;
}) {
  const ref = userCollection
    .doc(likerId)
    .collection('processedStripeInvoices')
    .doc(invoiceId);
  try {
    await ref.create({
      subscriptionId,
      processedAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + PROCESSED_INVOICE_TTL_MS),
    });
    return ref;
  } catch (err) {
    if ((err as { code?: number }).code === GRPC_ALREADY_EXISTS) return null;
    throw err;
  }
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
    likerId,
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

  // Emit once per invoice so retries don't duplicate side effects.
  const claimRef = await claimPlusInvoiceEmit({ likerId, invoiceId: invoice.id, subscriptionId });
  if (!claimRef) {
    // eslint-disable-next-line no-console
    console.warn(`Stripe invoice ${invoice.id} already emitted for ${likerId}; skipping duplicate side effects.`);
    return;
  }

  try {
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
  } catch (err) {
    // Release the claim so the retried webhook re-runs the side effects rather than
    // skipping them (emitPlusInvoiceAnalytics relies on Stripe retrying on failure).
    // A failed release strands the claim and permanently drops those effects — log it.
    await claimRef.delete().catch((delErr) => {
      // eslint-disable-next-line no-console
      console.error(`Failed to release Stripe invoice claim ${invoice.id} for ${likerId}:`, delErr);
    });
    throw err;
  }
}

// Look up the checkout user's email and Stripe customer id from their wallet.
// Throws 429 when the user already has an active Plus subscription.
async function resolvePlusCheckoutCustomer(wallet?: string): Promise<{
  userEmail?: string;
  customerId?: string;
}> {
  let userEmail;
  let customerId;
  if (wallet) {
    const userInfo = await getBookUserInfoFromWallet(wallet);
    if (userInfo) {
      const { bookUserInfo, likerUserInfo } = userInfo;
      if (likerUserInfo) {
        userEmail = likerUserInfo.email;
        // A shared-granted member may buy their own subscription: the paid sub
        // supersedes the shared grant (renewals then skip them — the shared-member
        // extend/revoke helpers only touch records with currentType 'shared').
        const isSharedGranted = likerUserInfo.likerPlus?.currentType === 'shared';
        if (likerUserInfo.isLikerPlus && !isSharedGranted) {
          throw new ValidationError('User already has a Liker Plus subscription.', 429);
        }
      }
      if (bookUserInfo) {
        customerId = bookUserInfo.stripeCustomerId;
      }
    }
  }
  return { userEmail, customerId };
}

type PlusCheckoutUTMInfo = {
  campaign?: string,
  source?: string,
  medium?: string,
  content?: string,
  term?: string,
};

// Client-side attribution forwarded into Stripe metadata and the checkout
// success/cancel URLs.
export type PlusCheckoutTrackingInfo = {
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
  utm?: PlusCheckoutUTMInfo,
};

// Build the subscription metadata and the session metadata (a superset that
// additionally carries the Google Ads click info). Every key is set only when
// present, and fbp/fbc/referrer are truncated to Stripe's value limits.
function buildPlusCheckoutMetadata({
  likeWallet,
  evmWallet,
  appUserId,
  paymentId,
  tier,
  affiliateFrom,
  affiliateGiftOnTrial,
  giftClassId,
  giftPriceIndex,
  tracking,
}: {
  likeWallet?: string,
  evmWallet?: string,
  appUserId?: string,
  paymentId: string,
  tier: LikerPlusTier,
  affiliateFrom?: string,
  affiliateGiftOnTrial?: boolean,
  giftClassId?: string,
  giftPriceIndex?: string,
  tracking: PlusCheckoutTrackingInfo,
}): { subscriptionMetadata: Stripe.MetadataParam; metadata: Stripe.MetadataParam } {
  const {
    from,
    utm,
    userAgent,
    clientIp,
    ipCountry,
    fbClickId,
    fbp,
    fbc,
    gaClientId,
    gaSessionId,
    referrer,
    gadClickId,
    gadSource,
  } = tracking;
  const subscriptionMetadata: Stripe.MetadataParam = {
    store: 'plus',
    // Informational — the webhook derives the tier from the product id, not this.
    tier,
  };
  if (likeWallet) subscriptionMetadata.likeWallet = likeWallet;
  if (evmWallet) subscriptionMetadata.evmWallet = evmWallet;
  // Our internal user id is the RevenueCat app_user_id. Nothing reads it yet; it
  // lets a future RevenueCat Stripe integration map this web subscription to the
  // same identity the mobile app logs in with (see GET /plus/revenuecat/config).
  if (appUserId) subscriptionMetadata.appUserId = appUserId;
  if (from) subscriptionMetadata.from = from;
  if (paymentId) subscriptionMetadata.paymentId = paymentId;
  if (affiliateFrom) subscriptionMetadata.affiliateFrom = affiliateFrom;
  if (affiliateGiftOnTrial !== undefined) {
    subscriptionMetadata.affiliateGiftOnTrial = affiliateGiftOnTrial ? 'true' : 'false';
  }
  if (giftClassId) subscriptionMetadata.giftClassId = giftClassId;
  if (giftPriceIndex !== undefined) {
    subscriptionMetadata.giftPriceIndex = giftPriceIndex;
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
  return { subscriptionMetadata, metadata };
}

// Pure assembly of the Stripe checkout session payload: line items (with the
// paid-trial one-time charge), trial settings, success/cancel URLs by UI mode,
// discounts vs promotion-code entry, and customer vs plain email.
function buildPlusCheckoutSessionPayload({
  period,
  tier,
  trialPeriodDays,
  mustCollectPaymentMethod,
  currency,
  isApp,
  uiMode,
  paymentId,
  subscriptionMetadata,
  metadata,
  discounts,
  customerId,
  userEmail,
  tracking,
}: {
  period: PlusPeriod,
  tier: LikerPlusTier,
  trialPeriodDays: number,
  mustCollectPaymentMethod: boolean,
  currency?: SupportedPlusCurrency,
  isApp?: boolean,
  uiMode: SupportedCheckoutUIMode,
  paymentId: string,
  subscriptionMetadata: Stripe.MetadataParam,
  metadata: Stripe.MetadataParam,
  discounts: Stripe.Checkout.SessionCreateParams.Discount[],
  customerId?: string,
  userEmail?: string,
  tracking: PlusCheckoutTrackingInfo,
}): Stripe.Checkout.SessionCreateParams {
  const {
    gaClientId, gaSessionId, gadClickId, gadSource, utm,
  } = tracking;
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

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: getPlusPriceId(tier, period),
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

  const urlTrackingParams = {
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
  };
  const successUrl = getPlusSuccessPageURL({
    period,
    tier,
    paymentId,
    hasFreeTrial,
    ...urlTrackingParams,
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
    payload.cancel_url = getPlusPageURL(urlTrackingParams);
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
  return payload;
}

export async function createNewPlusCheckoutSession(
  {
    period,
    tier = 'plus',
    trialPeriodDays = 0,
    mustCollectPaymentMethod = true,
    giftClassId,
    giftPriceIndex,
    coupon,
    currency,
    isApp,
    uiMode = 'hosted',
  }: {
    period: PlusPeriod,
    tier?: LikerPlusTier,
    trialPeriodDays?: number,
    mustCollectPaymentMethod?: boolean,
    giftClassId?: string,
    giftPriceIndex?: string,
    coupon?: string,
    currency?: SupportedPlusCurrency,
    isApp?: boolean,
    uiMode?: SupportedCheckoutUIMode,
  },
  tracking: PlusCheckoutTrackingInfo,
  req,
) {
  if (tier === 'civic') {
    // No trial for Civic (product decision) — its headline benefits (gifting,
    // premium voices) are instantly extractable, so a free window is an abuse vector.
    if (trialPeriodDays > 0) {
      throw new ValidationError('Civic subscriptions do not support trial periods.', 400);
    }
    // Inert until the Stripe product/prices are configured.
    if (!getPlusPriceId(tier, period)) {
      throw new ValidationError('CIVIC_TIER_NOT_AVAILABLE', 400);
    }
  }
  const paymentId = uuidv4();
  const {
    wallet,
    likeWallet,
    evmWallet,
    user: appUserId,
  } = req.user;
  const { from } = tracking;
  const { userEmail, customerId } = await resolvePlusCheckoutCustomer(wallet);

  const {
    giftClassId: resolvedGiftClassId,
    giftPriceIndex: resolvedGiftPriceIndex,
    affiliateFrom,
    affiliateGiftOnTrial,
  } = await resolveAffiliateGift({
    from, giftClassId, giftPriceIndex, period,
  });
  const { subscriptionMetadata, metadata } = buildPlusCheckoutMetadata({
    likeWallet,
    evmWallet,
    appUserId,
    paymentId,
    tier,
    affiliateFrom,
    affiliateGiftOnTrial,
    giftClassId: resolvedGiftClassId,
    giftPriceIndex: resolvedGiftPriceIndex,
    tracking,
  });

  const discounts = await resolveCheckoutDiscountsFromCoupon(coupon);
  const payload = buildPlusCheckoutSessionPayload({
    period,
    tier,
    trialPeriodDays,
    mustCollectPaymentMethod,
    currency,
    isApp,
    uiMode,
    paymentId,
    subscriptionMetadata,
    metadata,
    discounts,
    customerId,
    userEmail,
    tracking,
  });
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
  if (subscription.status !== 'canceled' && subscription.status !== 'unpaid') {
    return;
  }

  // User is optional here: wallet-less or unresolved cancellations still emit analytics below,
  // only the Firestore/Intercom writes are skipped.
  const user = (evmWallet || likeWallet)
    ? await getUserWithCivicLikerPropertiesByWallet(evmWallet || likeWallet)
    : null;
  const likerId = user?.user;
  const isTrialEnd = subscription.trial_end && subscription.cancel_at === subscription.trial_end;

  if (user) {
    // A shared-granted record is owned by the giver's lifecycle, not this
    // (stale/foreign) Stripe subscription — never let it clobber the record.
    const isSharedGranted = isSharedGrantedLikerPlus(user.likerPlus);
    const currentPeriodEnd = user.likerPlus?.currentPeriodEnd;
    if (!isSharedGranted) {
      if (currentPeriodEnd && currentPeriodEnd > Date.now()) {
        await userCollection.doc(user.user).update({
          likerPlus: {
            ...user.likerPlus,
            currentPeriodEnd: Date.now(),
            subscriptionStatus: 'canceled',
          },
        });
      }

      await updateIntercomUserAttributes(user.user, {
        is_liker_plus: false,
        is_liker_plus_trial: false,
        liker_plus_tier: '',
      });
    }

    // A canceled Civic sub takes its members' access with it.
    if (user.likerPlus?.tier === 'civic') {
      await revokeSharedMemberAccess(user.user);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(`No user record for evmWallet: ${evmWallet}, likeWallet: ${likeWallet}, subscription: ${subscriptionId}; emitting analytics only`);
  }

  const subscriptionItem = subscription.items?.data[0];
  const period = subscriptionItem?.plan?.interval;
  const priceId = subscriptionItem?.price?.id;
  // Wallet-less checkouts have no identity to attribute to; emit under a synthetic
  // customer-scoped id so the churn is still counted, flagged as unattributed.
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  const isUnattributed = !evmWallet && !likeWallet;
  const cancellationExtraProperties = {
    subscription_id: subscriptionId,
    period,
    price_id: priceId,
    cancel_reason: subscription.cancellation_details?.reason,
    cancel_feedback: subscription.cancellation_details?.feedback,
    cancel_comment: subscription.cancellation_details?.comment?.substring(0, 500),
    ...(isUnattributed ? { unattributed: true } : {}),
    ...mapAttributionExtraProperties({
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm, from,
    }),
  };
  const analyticsOptions = {
    evmWallet,
    likeWallet,
    paymentId: subscriptionId,
    posthogDistinctId: isUnattributed && customerId ? `stripe:${customerId}` : undefined,
    extraProperties: cancellationExtraProperties,
  };
  await Promise.all([
    ...(likerId ? [sendIntercomEvent({
      userId: likerId,
      eventName: isTrialEnd ? 'plus_trial_end' : 'plus_subscription_end',
    })] : []),
    logServerEvents(isTrialEnd ? 'TrialEnded' : 'SubscriptionCancelled', analyticsOptions),
  ]);
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
  req?: Express.Request,
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
  const userUpdate: Record<string, unknown> = {};
  if (user.likerPlus?.subscriptionStatus !== subscriptionStatus) {
    userUpdate['likerPlus.subscriptionStatus'] = subscriptionStatus;
  }
  // Mirror tier/period from the live subscription item so a plan change applied
  // outside /plus/price (Billing Portal confirm flow, Stripe Dashboard) flips
  // the entitlement without waiting on its invoice.paid, which may lag payment
  // authentication. invoice.paid stays the money-side source of truth (accrual,
  // shared-member seats, analytics). Only the record this subscription owns.
  const item = subscription.items.data[0];
  const tier = derivePlusTierFromProductId(item?.price.product as string);
  const period = item?.plan.interval;
  const previousTier: LikerPlusTier = user.likerPlus?.tier || 'plus';
  const previousPeriod = user.likerPlus?.period;
  const isPlanChanged = !!(tier && period)
    && user.likerPlus?.subscriptionId === subscription.id
    && (tier !== previousTier || period !== previousPeriod);
  if (isPlanChanged) {
    userUpdate['likerPlus.tier'] = tier;
    userUpdate['likerPlus.period'] = period;
  }
  if (!Object.keys(userUpdate).length) return;
  await userCollection.doc(user.user).update(userUpdate);
  if (isPlanChanged) {
    // `source` lets analytics dedupe against the /plus/price route, which logs
    // the same logType up front for changes it applies itself.
    publisher.publish(PUBSUB_TOPIC_MISC, req ?? null, {
      logType: 'PlusSubscriptionPlanUpdated',
      source: 'stripe-webhook',
      subscriptionId: subscription.id,
      period: stripeIntervalToPlusPeriod(period),
      tier,
      previousPeriod,
      previousTier,
      wallet: evmWallet || likeWallet,
    });
  }
}

export async function updateSubscriptionPeriod(
  subscriptionId: string,
  period: PlusPeriod,
  {
    // Required: a 'plus' default would silently downgrade Civic subscribers
    // on a period-only change. Callers resolve the current tier themselves.
    tier,
    giftClassId,
    giftPriceIndex,
  }: {
    tier: LikerPlusTier;
    giftClassId?: string;
    giftPriceIndex?: string;
  },
) {
  if (tier === 'civic' && !getPlusPriceId(tier, period)) {
    throw new ValidationError('CIVIC_TIER_NOT_AVAILABLE', 400);
  }
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const { metadata } = subscription;
  // An unrecognised metadata tier must fall back to 'plus', not to indexOf -1,
  // which would make every switch look like an upgrade and force an invoice.
  const previousTier: LikerPlusTier = LIKER_PLUS_TIERS
    .includes(metadata.tier as LikerPlusTier) ? metadata.tier as LikerPlusTier : 'plus';
  const isTierUpgrade = comparePlusTiers(tier, previousTier) > 0;
  metadata.tier = tier;
  if (giftClassId) metadata.giftClassId = giftClassId;
  if (giftPriceIndex) metadata.giftPriceIndex = giftPriceIndex;
  if (period === 'yearly') metadata.isUpgradingPrice = 'true';
  // Tier and period switches apply immediately; proration_behavior is resolved below.
  const updatePayload: Stripe.SubscriptionUpdateParams = {
    items: [
      {
        id: subscription.items.data[0].id,
        price: getPlusPriceId(tier, period),
      },
    ],
    metadata,
  };
  const isInTrial = subscription.status === 'trialing';
  if (isInTrial) {
    updatePayload.trial_end = 'now';
    updatePayload.proration_behavior = 'none';
    updatePayload.billing_cycle_anchor = 'now';
  } else if (isTierUpgrade) {
    // Force an immediate prorated invoice on a tier upgrade (e.g. Plus -> Civic)
    // so invoice.paid fires now and the webhook writes likerPlus.tier promptly.
    // Stripe's default proration would defer the charge, and the tier flip, to
    // the next renewal. Downgrades keep the default so they credit at renewal.
    updatePayload.proration_behavior = 'always_invoice';
  }
  await stripe.subscriptions.update(
    subscriptionId,
    updatePayload,
  );
}

// Stripe-hosted confirmation for a paid tier/period upgrade: a Billing Portal
// deep link (subscription_update_confirm) shows the member the exact prorated
// charge and the card on file, and runs 3DS on-session, before the update is
// applied — unlike updateSubscriptionPeriod, which charges off-session with no
// confirmation. The dedicated portal configuration pins proration to
// 'always_invoice' so the upgrade invoices immediately and invoice.paid flips
// likerPlus.tier promptly. Returns the session plus a generated paymentId that
// the success page uses as its analytics transaction id.
export async function createPlusUpgradePortalSession({
  customerId,
  subscriptionId,
  tier,
  period,
}: {
  customerId: string;
  subscriptionId: string;
  tier: LikerPlusTier;
  period: PlusPeriod;
}): Promise<{ session: Stripe.BillingPortal.Session; paymentId: string }> {
  if (!LIKER_PLUS_UPGRADE_PORTAL_CONFIG_ID) {
    throw new ValidationError('UPGRADE_PORTAL_NOT_AVAILABLE', 400);
  }
  const priceId = getPlusPriceId(tier, period);
  if (!priceId) {
    throw new ValidationError('CIVIC_TIER_NOT_AVAILABLE', 400);
  }
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  // Trials are blocked (the web gates them too): the portal would apply the
  // configuration's trial_update_behavior instead of the /plus/price trial
  // handling (trial_end now, no proration, cycle reset).
  if (subscription.status === 'trialing') {
    throw new ValidationError('Cannot upgrade a trial subscription.', 400);
  }
  const item = subscription.items.data[0];
  if (!item) {
    throw new ValidationError('No subscription item found.', 400);
  }
  const paymentId = uuidv4();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration: LIKER_PLUS_UPGRADE_PORTAL_CONFIG_ID,
    // "Go back" from the portal must land on the pricing page, not a charge.
    return_url: getPlusPageURL({ plan: period }),
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: subscriptionId,
        items: [
          {
            id: item.id,
            price: priceId,
            quantity: 1,
          },
        ],
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          return_url: getPlusUpgradeSuccessPageURL({ period, tier, paymentId }),
        },
      },
    },
  });
  return { session, paymentId };
}
