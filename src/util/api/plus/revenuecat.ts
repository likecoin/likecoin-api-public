import { v4 as uuidv4 } from 'uuid';
import type { LikerPlusData } from '../../../types/user';

import { IS_TESTNET, PUBSUB_TOPIC_MISC, SUBSCRIPTION_GRACE_PERIOD } from '../../../constant';
import type { LikerPlusTier } from '../../../constant';
import { userCollection } from '../../firebase';
import { normalizeLikerId } from '../../ValidationHelper';
import { getUserWithCivicLikerProperties } from '../users/getPublicInfo';
import { getCustomerType, getPaymentUpdateFields } from '../users/payment';
import { createFreeBookCartFromSubscription } from '../likernft/book/cart';
import {
  getPlusEquivalentUSDPrice,
  getPlusPredictedLTV,
  mapAttributionExtraProperties,
  resolveAffiliateGift,
} from './index';
import { calculatePlusDailyValue, recordPlusSubscriptionAccrual } from './revenueShare';
import { updateIntercomUserAttributes, sendIntercomEvent } from '../../intercom';
import { sendPlusSubscriptionSlackNotification } from '../../slack';
import { createAirtableSubscriptionPaymentRecord } from '../../airtable';
import logServerEvents from '../../logServerEvents';
import publisher from '../../gcloudPub';
import { splitByComma } from '../../misc';
import {
  REVENUECAT_PLUS_ENTITLEMENT_ID,
  REVENUECAT_PLUS_MONTHLY_PRODUCT_IDS,
  REVENUECAT_PLUS_YEARLY_PRODUCT_IDS,
  REVENUECAT_CIVIC_ENTITLEMENT_ID,
  REVENUECAT_CIVIC_MONTHLY_PRODUCT_IDS,
  REVENUECAT_CIVIC_YEARLY_PRODUCT_IDS,
} from '../../../../config/config';

// Unified RevenueCat webhook event. Only the fields we consume are typed; the
// payload carries many more (see https://www.revenuecat.com/docs/integrations/webhooks).
// Field names mirror RevenueCat's snake_case wire format.
/* eslint-disable camelcase */
export interface RevenueCatEvent {
  type: string;
  id?: string;
  app_user_id?: string;
  aliases?: string[];
  original_app_user_id?: string;
  product_id?: string;
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  period_type?: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL';
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  store?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  price?: number;
  price_in_purchased_currency?: number;
  currency?: string;
  original_transaction_id?: string;
  cancel_reason?: string;
  expiration_reason?: string;
  // TRANSFER events only
  transferred_from?: string[];
  transferred_to?: string[];
  // Custom subscriber attributes the native app sets before purchase (gift book,
  // affiliate channel, ad-attribution ids). Each is { value, updated_at_ms }.
  subscriber_attributes?: Record<string, { value?: string; updated_at_ms?: number }>;
}
/* eslint-enable camelcase */

// RevenueCat's `price` is normalized to USD, while `currency` describes
// `price_in_purchased_currency` (the amount the customer actually paid). Pairing
// `price` with `currency` mislabels USD amounts as the local currency. Return a
// consistent (amount, currency) pair: the local charge when present, else USD.
export function getRevenueCatPaymentAmount(
  event: RevenueCatEvent,
): { amount?: number; currency?: string } {
  if (event.price_in_purchased_currency != null && event.currency) {
    return { amount: event.price_in_purchased_currency, currency: event.currency };
  }
  if (event.price != null) {
    return { amount: event.price, currency: 'USD' };
  }
  return {};
}

// Read a custom subscriber attribute the native app set before purchase. Empty
// strings (RevenueCat's tombstone for a cleared attribute) collapse to undefined.
function getSubscriberAttribute(event: RevenueCatEvent, key: string): string | undefined {
  const value = event.subscriber_attributes?.[key]?.value;
  return value === '' ? undefined : value;
}

const RC_ANONYMOUS_ID_PREFIX = '$RCAnonymousID:';

function isAnonymousId(id?: string): boolean {
  return !!id && id.startsWith(RC_ANONYMOUS_ID_PREFIX);
}

// RevenueCat may emit an anonymous app_user_id when a purchase happens before the
// SDK calls logIn(). Prefer the first non-anonymous identity from app_user_id then
// aliases — that is our internal user id.
function resolveAppUserId(event: RevenueCatEvent): string | undefined {
  const candidates = [event.app_user_id, ...(event.aliases || [])];
  return candidates.find((id) => id && !isAnonymousId(id));
}

// config exposes the raw comma-separated env strings; parse them into id lists once.
const monthlyProductIds = splitByComma(REVENUECAT_PLUS_MONTHLY_PRODUCT_IDS);
const yearlyProductIds = splitByComma(REVENUECAT_PLUS_YEARLY_PRODUCT_IDS);
const civicMonthlyProductIds = splitByComma(REVENUECAT_CIVIC_MONTHLY_PRODUCT_IDS);
const civicYearlyProductIds = splitByComma(REVENUECAT_CIVIC_YEARLY_PRODUCT_IDS);

function mapProductIdToTierAndPeriod(
  productId?: string,
): { tier: LikerPlusTier; period: 'month' | 'year' } | undefined {
  if (!productId) return undefined;
  if (civicMonthlyProductIds.includes(productId)) return { tier: 'civic', period: 'month' };
  if (civicYearlyProductIds.includes(productId)) return { tier: 'civic', period: 'year' };
  if (monthlyProductIds.includes(productId)) return { tier: 'plus', period: 'month' };
  if (yearlyProductIds.includes(productId)) return { tier: 'plus', period: 'year' };
  return undefined;
}

function getEventEntitlementIds(event: RevenueCatEvent): string[] {
  return event.entitlement_ids || (event.entitlement_id ? [event.entitlement_id] : []);
}

function isPlusEntitlement(event: RevenueCatEvent): boolean {
  if (!REVENUECAT_PLUS_ENTITLEMENT_ID) return true;
  const ids = getEventEntitlementIds(event);
  // When the entitlement list is present, require our Plus entitlement. Civic
  // products should grant both entitlements (dashboard convention), but accept
  // a civic-only list so a misconfigured product still lands as a grant.
  if (ids.length) {
    return ids.includes(REVENUECAT_PLUS_ENTITLEMENT_ID)
      || (!!REVENUECAT_CIVIC_ENTITLEMENT_ID && ids.includes(REVENUECAT_CIVIC_ENTITLEMENT_ID));
  }
  // When entitlement info is absent, fall back to a known product id so an
  // unrelated product's subscription event can't be granted Plus by mistake.
  return !!mapProductIdToTierAndPeriod(event.product_id);
}

// A record is Stripe-owned (web) if the Stripe path wrote it. Legacy records
// predate the `provider` field but still carry Stripe's subscriptionId/customerId;
// RevenueCat grants never set those, so their presence is a definitive signal.
// Terminal RevenueCat events must not revoke such records.
function isStripeOwnedLikerPlus(likerPlus?: LikerPlusData): boolean {
  if (!likerPlus) return false;
  return likerPlus.provider === 'stripe'
    || !!likerPlus.subscriptionId
    || !!likerPlus.customerId;
}

// Whether a Plus record still confers access right now — mirrors getPublicInfo's
// window: currentPeriodStart <= now <= currentPeriodEnd + grace. A missing/zero
// period end reads as expired.
function hasLivePlusAccess(likerPlus?: LikerPlusData): boolean {
  const now = Date.now();
  const start = likerPlus?.currentPeriodStart || 0;
  const end = likerPlus?.currentPeriodEnd || 0;
  if (!end) return false;
  return start <= now && now <= end + SUBSCRIPTION_GRACE_PERIOD;
}

// SANDBOX events landing on the prod backend are quarantined: the resulting
// record gets an environment:'SANDBOX' tag (so dashboards filter them) and
// monetary/CRM side effects (Slack, Airtable, Intercom paid attributes,
// logServerEvents) are skipped to keep prod metrics clean. Testnet does NOT
// quarantine — it has its own testnet-scoped Airtable/Slack/Intercom that
// devs use to verify integrations end-to-end, so all side effects fire as
// usual when the testnet backend receives SANDBOX events.
function isQuarantinedSandbox(isSandbox: boolean): boolean {
  return isSandbox && !IS_TESTNET;
}

// Prevent SANDBOX events on prod from mutating a non-sandbox record with live
// access. Without this, an App Store reviewer (or anyone with a sandbox account)
// who collides on app_user_id with an existing paid user could clobber their
// real sub. Testnet has no production records to protect, so the guard is a
// no-op there. Mirrors the shape of isStripeOwnedLikerPlus — terminal events
// only revoke records owned by the same environment.
// Expired non-sandbox records are not protected — there is no live access to
// clobber. Expiry matches getPublicInfo's boundary (currentPeriodEnd + grace).
function isSandboxLockedOut(isSandbox: boolean, likerPlus?: LikerPlusData): boolean {
  if (!isSandbox || IS_TESTNET) return false;
  if (!likerPlus) return false;
  if (likerPlus.environment === 'SANDBOX') return false;
  return hasLivePlusAccess(likerPlus);
}

const GRANT_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
]);

async function handleGrant(
  event: RevenueCatEvent,
  likerId: string,
  user: {
    email?: string;
    evmWallet?: string;
    likerPlus?: LikerPlusData;
    firstPaidAt?: unknown;
  },
  isSandbox: boolean,
  req: Express.Request,
) {
  if (isSandboxLockedOut(isSandbox, user.likerPlus)) return;

  const isInitial = event.type === 'INITIAL_PURCHASE';
  const isTrial = event.period_type === 'TRIAL';
  const purchasedAtMs = event.purchased_at_ms || Date.now();
  const transactionId = event.original_transaction_id || event.id;
  // Gift attribution is keyed to one subscription's original_transaction_id. A
  // cancel→resubscribe is a fresh INITIAL_PURCHASE with a new id, so it starts clean;
  // renewals and redelivered events match the stored id and keep their gift.
  const isSameSubscription = !isInitial
    || (!!event.original_transaction_id
      && user.likerPlus?.originalTransactionId === event.original_transaction_id);
  const currentPeriodEnd = event.expiration_at_ms || user.likerPlus?.currentPeriodEnd;
  // A subscription grant must resolve to a real period end. Persisting 0/undefined
  // alongside subscriptionStatus 'active' yields an active-but-expired record that
  // reads as expired downstream (getPublicInfo caps access on currentPeriodEnd). Skip
  // rather than corrupt the shared record — real RC subscription grants always carry
  // expiration_at_ms, so this only trips on malformed/misconfigured payloads.
  if (!currentPeriodEnd) {
    // eslint-disable-next-line no-console
    console.warn(`RevenueCat ${event.type} for ${likerId} has no resolvable currentPeriodEnd; skipping grant`);
    return;
  }
  const productMapping = mapProductIdToTierAndPeriod(event.product_id);
  const period = productMapping?.period || user.likerPlus?.period;
  // Tier: the product mapping is authoritative; else the civic entitlement on
  // the event; else preserve the stored tier (renewals may omit product info).
  let tier: LikerPlusTier | undefined = productMapping?.tier;
  if (!tier && REVENUECAT_CIVIC_ENTITLEMENT_ID
    && getEventEntitlementIds(event).includes(REVENUECAT_CIVIC_ENTITLEMENT_ID)) {
    tier = 'civic';
  }
  if (!tier) tier = user.likerPlus?.tier || 'plus';
  const since = isInitial
    ? purchasedAtMs
    : (user.likerPlus?.since || purchasedAtMs);

  // Per-day value of this term, funding the reading-library revenue-share pool.
  // Gated on the same `isTrial` as currentType so the two always agree. RevenueCat's
  // `price` is normalized to USD, so the pool funds in USD — the actual transaction
  // price still captures intro/promotional and monthly/yearly differences.
  // Uncancel/extend/product-change grants carry no `price` (no new charge); preserve
  // the stored dailyValue rather than zeroing accrual until the next priced renewal.
  // Civic funds at the Plus-tier rate (see getPlusEquivalentUSDPrice), never
  // its own 10× charge.
  let dailyValue = 0;
  if (!isTrial) {
    let fundingAmount = event.price;
    if (tier === 'civic') {
      fundingAmount = getPlusEquivalentUSDPrice(period);
    }
    dailyValue = event.price != null && fundingAmount != null
      ? calculatePlusDailyValue({
        amountPaid: fundingAmount,
        currentPeriodStart: purchasedAtMs,
        currentPeriodEnd,
      })
      : (user.likerPlus?.dailyValue ?? 0);
  }

  const likerPlus: LikerPlusData = {
    since,
    tier,
    currentPeriodStart: purchasedAtMs,
    currentPeriodEnd,
    currentType: isTrial ? 'trial' : 'paid',
    dailyValue,
    dailyValueCurrency: 'USD',
    subscriptionStatus: 'active',
    provider: 'revenuecat',
  };
  // Omit undefined optional fields — Firestore rejects undefined values.
  if (period) likerPlus.period = period;
  if (event.store) likerPlus.store = event.store;
  if (event.original_transaction_id) {
    likerPlus.originalTransactionId = event.original_transaction_id;
  }
  if (isSandbox) likerPlus.environment = 'SANDBOX';
  // Carry sticky gift attribution forward so this whole-object overwrite doesn't
  // wipe it (GET /plus/gift reads these for RevenueCat users). A resubscribe is a
  // new subscription, so it's not carried — the gift block reassigns instead.
  if (isSameSubscription) {
    if (user.likerPlus?.giftClassId) likerPlus.giftClassId = user.likerPlus.giftClassId;
    if (user.likerPlus?.giftCartId) likerPlus.giftCartId = user.likerPlus.giftCartId;
    if (user.likerPlus?.giftPaymentId) likerPlus.giftPaymentId = user.likerPlus.giftPaymentId;
    if (user.likerPlus?.giftClaimToken) likerPlus.giftClaimToken = user.likerPlus.giftClaimToken;
    if (user.likerPlus?.affiliateFrom) likerPlus.affiliateFrom = user.likerPlus.affiliateFrom;
  }
  // A real charge: priced, non-trial grants. Trials and no-charge grants
  // (uncancel/extend/product-change) carry no price. Reused by the gift block below.
  const hasCharge = !isTrial && event.price != null && event.price > 0;
  const grantUpdate: Record<string, unknown> = { likerPlus };
  // Track first/last real payment like the Stripe path so getCustomerType can tell
  // resubscribers from first-time buyers.
  if (hasCharge) {
    Object.assign(grantUpdate, getPaymentUpdateFields(!!user.firstPaidAt));
  }
  await userCollection.doc(likerId).update(grantUpdate);

  // Skip the cross-Liker-ID dedupe query only when this Liker ID already RC-owns
  // this transaction with still-active access (the dominant case for RENEWAL et
  // al.) — a continuously-active holder already revoked any rival at its initial
  // grant, so a renewal introduces no new collision. If the prior record is
  // expired or canceled, this grant is a reactivation that may collide with a
  // holder the sub bounced to in between, so still run the dedupe. Stripe-owned
  // prior records also need the dedupe in case the user is migrating off Stripe
  // onto an existing mobile sub.
  const destinationAlreadyOwnsTransaction = !!user.likerPlus
    && user.likerPlus.originalTransactionId === event.original_transaction_id
    && !isStripeOwnedLikerPlus(user.likerPlus)
    && user.likerPlus.subscriptionStatus === 'active'
    && hasLivePlusAccess(user.likerPlus);
  if (event.original_transaction_id && !destinationAlreadyOwnsTransaction) {
    try {
      // eslint-disable-next-line no-use-before-define
      await revokeOtherHoldersOfTransaction(
        event.original_transaction_id,
        likerId,
        purchasedAtMs,
        isSandbox,
        req,
      );
    } catch (err) {
      // Don't let a missing Firestore index or transient query failure drop the
      // grant's downstream side effects (Intercom, Slack, Airtable, analytics).
      // Falls back to "trust RC's TRANSFER" — same protection level as before
      // this dedupe existed.
      // eslint-disable-next-line no-console
      console.error('revokeOtherHoldersOfTransaction failed; grant proceeds without dedupe', err);
    }
  }

  // Quarantine reviewer (sandbox-on-prod) traffic out of CRM, Slack, revenue
  // analytics, and Airtable so it doesn't contaminate prod metrics. Testnet's
  // own testnet-scoped integrations still fire as usual.
  if (isQuarantinedSandbox(isSandbox)) return;

  // Gift book + affiliate attribution conveyed by the native app as RevenueCat
  // subscriber attributes (set before purchase, delivered in subscriber_attributes).
  // Mirrors the Stripe checkout: resolveAffiliateGift turns the channel `from` and
  // the upsell `giftClassId` into the resolved gift book, and affiliate attribution
  // is persisted to `plusAffiliateFrom`. Stripe stores the gift in the subscription
  // metadata; RevenueCat has no subscription, so we persist it on the shared record
  // for GET /plus/gift to read back. Only on the initial purchase.
  if (isInitial) {
    const fromAttr = getSubscriberAttribute(event, 'plusFrom');
    const giftClassIdAttr = getSubscriberAttribute(event, 'plusGiftClassId');
    if (fromAttr || giftClassIdAttr) {
      try {
        const planPeriod = period === 'year' ? 'yearly' : 'monthly';
        const {
          giftClassId: resolvedGiftClassId,
          giftPriceIndex: resolvedGiftPriceIndex,
          affiliateFrom,
          affiliateGiftOnTrial,
        } = await resolveAffiliateGift({
          from: fromAttr,
          giftClassId: giftClassIdAttr,
          period: planPeriod,
        });

        const userUpdate: { plusAffiliateFrom?: string; likerPlus?: LikerPlusData } = {};
        // Affiliate attribution applies to any plan, mirroring the Stripe path
        // which sets plusAffiliateFrom at subscription creation. Also persist it onto
        // likerPlus so GET /plus/gift (which reads likerPlus for RevenueCat users) sees
        // it even when no gift cart is created — e.g. monthly plans or trials. The gift
        // block below re-includes affiliateFrom, so its overwrite keeps this.
        if (affiliateFrom) {
          userUpdate.plusAffiliateFrom = normalizeLikerId(affiliateFrom);
          userUpdate.likerPlus = { ...likerPlus, affiliateFrom };
        }

        // Gift books only attach to yearly, on a real charge — except an affiliate
        // `giftOnTrial` gift granted at trial start. The giftCartId guard keeps a
        // re-delivered INITIAL_PURCHASE idempotent, but only for the same
        // subscription — a resubscribe earns a fresh gift even though the lapsed
        // sub's giftCartId still lingers on the record.
        const isGiftEligible = hasCharge || (!!affiliateGiftOnTrial && isTrial);
        if (
          planPeriod === 'yearly'
          && resolvedGiftClassId
          && !(isSameSubscription && user.likerPlus?.giftCartId)
          && isGiftEligible
        ) {
          const result = await createFreeBookCartFromSubscription({
            cartId: uuidv4(),
            classId: resolvedGiftClassId,
            priceIndex: parseInt(resolvedGiftPriceIndex || '0', 10) || 0,
            // RevenueCat's `price` is USD-normalized, matching the USD book-price
            // ceiling the cart helper checks against. 0 for trial gifts (no charge).
            amountPaid: event.price || 0,
            isTrialGift: !!affiliateGiftOnTrial && isTrial,
          }, {
            evmWallet: user.evmWallet,
            // Coerce to null for wallet-only accounts: Firestore rejects
            // `undefined`, which would fail the cart write under the best-effort catch.
            email: user.email ?? null,
          });
          if (result) {
            userUpdate.likerPlus = {
              ...likerPlus,
              giftClassId: resolvedGiftClassId,
              giftCartId: result.cartId,
              giftPaymentId: result.paymentId,
              giftClaimToken: result.claimToken,
              ...(affiliateFrom ? { affiliateFrom } : {}),
            };
          }
        }
        if (Object.keys(userUpdate).length) {
          await userCollection.doc(likerId).update(userUpdate);
        }
      } catch (err) {
        // Best-effort: a failed gift/affiliate write must not fail the webhook
        // (RevenueCat would otherwise retry the whole grant).
        // eslint-disable-next-line no-console
        console.error(`Error applying IAP gift/affiliate for ${likerId}:`, err);
      }
    }
  }

  // Accrue this term's value to the rev-share pool. Only on a real new charge
  // (`price` present) — never trials or uncancel/extend grants, which carry no price
  // and would otherwise re-fund a term. RC `price` is already USD. Placed after the
  // quarantine return so reviewer/sandbox traffic never funds real payouts.
  if (!isTrial && event.price != null && dailyValue > 0 && transactionId) {
    // Best-effort: accrual is not yet used for payouts, so a transient Firestore
    // failure must not fail (and make RevenueCat retry) the subscription webhook.
    try {
      await recordPlusSubscriptionAccrual({
        likerId,
        subscriptionId: transactionId,
        dailyValueUSD: dailyValue,
        // Original charge currency for audit; `dailyValueUSD` itself is always USD.
        // `event.currency` is the ISO code the product was purchased in (NULL when
        // unknown — RevenueCat's `price` is already USD, so fall back to USD).
        currency: event.currency || 'USD',
        currentPeriodStart: purchasedAtMs,
        currentPeriodEnd,
        provider: 'revenuecat',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Error recording Plus reading accrual for ${likerId}:`, err);
    }
  }

  await updateIntercomUserAttributes(likerId, {
    is_liker_plus: true,
    is_liker_plus_trial: isTrial,
    liker_plus_tier: tier,
  });
  if (isInitial) {
    await sendIntercomEvent({
      userId: likerId,
      eventName: isTrial ? 'plus_trial_start' : 'plus_subscription_start',
    });
  }

  let logEvent: 'StartTrial' | 'Subscribe' | 'SubscriptionRenewed' | undefined;
  if (isInitial) logEvent = isTrial ? 'StartTrial' : 'Subscribe';
  else if (event.type === 'RENEWAL') logEvent = 'SubscriptionRenewed';

  // Resolve once and reuse across Slack, analytics, and the Airtable record.
  const { amount: paymentAmount, currency: paymentCurrency } = getRevenueCatPaymentAmount(event);

  // Independent notifications/analytics — fire in parallel (matches the Stripe path).
  const sideEffects: Promise<unknown>[] = [
    sendPlusSubscriptionSlackNotification({
      subscriptionId: transactionId || 'N/A',
      email: user.email || 'N/A',
      priceWithCurrency: paymentAmount != null && paymentCurrency
        ? `${paymentAmount.toFixed(2)} ${paymentCurrency}`
        : 'N/A',
      isNew: isInitial,
      userId: likerId,
      method: 'revenuecat',
      isTrial,
    }),
  ];
  if (logEvent) {
    // Mirror the Stripe path's value signal so Meta/GA optimize the same for web
    // and IAP — app IAP trials charge 0, so value falls back to predicted LTV.
    const {
      value: predictedLTV,
      currency: ltvCurrency,
    } = getPlusPredictedLTV(isTrial, paymentCurrency);
    // Ad-attribution the native app forwarded as subscriber attributes, so the
    // IAP server-side conversion (Meta CAPI / GA / PostHog) carries the same
    // attribution the Stripe Subscribe/StartTrial event does (see index.ts).
    const referrer = getSubscriberAttribute(event, 'referrer');
    // Shared payload for the Subscribe/StartTrial/Renewed event and PlusAcquisition,
    // which mirror the Stripe path and must carry identical attribution and value. The
    // isInitial-conditional fields resolve to their unconditional form in the
    // PlusAcquisition branch below (which only fires when isInitial), so it reuses them.
    const acquisitionEventPayload = {
      email: user.email,
      evmWallet: user.evmWallet,
      value: isTrial ? predictedLTV : paymentAmount,
      // ltvCurrency is a lowercase Plus currency; uppercase both branches so the
      // analytics currency dimension stays ISO 4217 like the Stripe path.
      currency: isTrial ? ltvCurrency.toUpperCase() : paymentCurrency?.toUpperCase(),
      paymentId: transactionId,
      items: period ? [{ productId: `${tier}-${period}ly`, quantity: 1 }] : undefined,
      referrer,
      fbClickId: getSubscriberAttribute(event, 'fbClickId'),
      fbp: getSubscriberAttribute(event, 'fbp'),
      fbc: getSubscriberAttribute(event, 'fbc'),
      gaClientId: getSubscriberAttribute(event, 'gaClientId'),
      gaSessionId: getSubscriberAttribute(event, 'gaSessionId'),
      posthogDistinctId: getSubscriberAttribute(event, 'posthogDistinctId'),
      predictedLTV: isInitial ? predictedLTV : undefined,
      customerType: isInitial ? getCustomerType(user) : 'returning',
      extraProperties: {
        // transactionId is original_transaction_id (stable across the sub lifetime),
        // so it serves as subscription_id here — parity with the Stripe path.
        subscription_id: transactionId,
        provider: 'revenuecat',
        platform: 'app',
        store: event.store,
        product_id: event.product_id,
        period,
        tier,
        ...mapAttributionExtraProperties({
          utmSource: getSubscriberAttribute(event, 'utmSource'),
          utmMedium: getSubscriberAttribute(event, 'utmMedium'),
          utmCampaign: getSubscriberAttribute(event, 'utmCampaign'),
          utmContent: getSubscriberAttribute(event, 'utmContent'),
          utmTerm: getSubscriberAttribute(event, 'utmTerm'),
          from: getSubscriberAttribute(event, 'plusFrom'),
        }),
        gad_click_id: getSubscriberAttribute(event, 'gadClickId'),
        gad_source: getSubscriberAttribute(event, 'gadSource'),
        $referrer: referrer,
      },
      setOnce: referrer ? { $initial_referrer: referrer } : undefined,
    };
    sideEffects.push(logServerEvents(logEvent, acquisitionEventPayload));
    // Unified acquisition event — one per new subscription, the single signal to
    // optimize Meta on (mirrors the Stripe path; app has no browser pixel to mirror).
    // Gated on isInitial so renewals never inflate it.
    if (isInitial) {
      sideEffects.push(logServerEvents('PlusAcquisition', {
        ...acquisitionEventPayload,
        extraProperties: { ...acquisitionEventPayload.extraProperties, is_trial: isTrial },
      }));
    }
    // Mirror the Stripe path's Airtable payment record. RevenueCat carries no Stripe
    // customer/invoice/coupon/price-id, so those columns stay empty; record only on
    // payment-bearing events (initial purchase + renewal) — the same gate as the
    // analytics event above — to avoid spurious rows for uncancel/extend grants.
    sideEffects.push(createAirtableSubscriptionPaymentRecord({
      subscriptionId: transactionId || '',
      customerId: '',
      customerEmail: user.email || '',
      customerUserId: likerId,
      customerWallet: user.evmWallet || '',
      productId: event.product_id,
      price: paymentAmount,
      currency: paymentCurrency,
      since,
      periodInterval: period || '',
      periodStartAt: purchasedAtMs,
      periodEndAt: currentPeriodEnd,
      isNew: isInitial,
      isTrial,
    }));
  }
  await Promise.all(sideEffects);
}

// Merge terminal changes into the shared Plus record from RevenueCat's side.
// Shared by expiration and transfer-away. Intercom flag clearing is left to
// callers so quarantined sandbox-on-prod events can skip the spurious CRM write.
async function revokeLikerPlus(
  likerId: string,
  likerPlus: LikerPlusData,
  changes: Partial<LikerPlusData>,
) {
  await userCollection.doc(likerId).update({
    likerPlus: { ...likerPlus, ...changes, provider: 'revenuecat' },
  });
}

async function clearIntercomPlusFlags(likerId: string) {
  await updateIntercomUserAttributes(likerId, {
    is_liker_plus: false,
    is_liker_plus_trial: false,
    liker_plus_tier: '',
  });
}

// Shared "revoke RC-owned Plus + clear Intercom flags" used by terminal RC
// events (transfer-away, dedupe). Returns true if the revoke actually ran so
// callers can audit-log only on real revocations.
async function revokeIfRevenueCatOwned(
  likerId: string,
  likerPlus: LikerPlusData | undefined,
  isSandbox: boolean,
): Promise<boolean> {
  if (!likerPlus) return false;
  if (isStripeOwnedLikerPlus(likerPlus)) return false;
  if (isSandboxLockedOut(isSandbox, likerPlus)) return false;
  // Revoke access first — the Firestore write is the source of truth. Only after
  // it succeeds do we report a real revocation (callers audit-log on the return
  // value) and touch CRM, so a failed revoke can never clear Intercom.
  await revokeLikerPlus(likerId, likerPlus, {
    currentPeriodEnd: Date.now(),
    subscriptionStatus: 'canceled',
  });
  // Best-effort CRM cleanup: a failed Intercom write must not mask the completed
  // revoke (would skip the caller's audit log) nor fail the webhook into a retry.
  if (!isQuarantinedSandbox(isSandbox)) {
    try {
      await clearIntercomPlusFlags(likerId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  return true;
}

// Enforce 1 sub = 1 Liker ID. When a grant arrives we revoke active Plus on any
// OTHER Liker ID currently tied to the same original_transaction_id, catching the
// gap where RevenueCat's TRANSFER event is missed/delayed (e.g. mobile app didn't
// call Purchases.logIn() before Restore Purchases) and Family Sharing siblings.
// Runs AFTER the destination grant is written so a failed write can't leave the
// user with no Plus at all.
// `keepPeriodStart` is this grant's currentPeriodStart. A holder is revoked only
// if this grant's claim is strictly newer, ties broken by liker id. That total
// order makes the "grant then query then revoke" safe under concurrency: two
// grants for the same transaction on different Liker IDs can't both win, so they
// never mutually revoke — the both-canceled outcome this guards against. Once
// both writes have committed exactly one survives; an unlucky interleaving (one
// query runs before the other's write lands) may briefly leave two, which is
// benign since the user keeps access.
async function revokeOtherHoldersOfTransaction(
  originalTransactionId: string,
  keepLikerId: string,
  keepPeriodStart: number,
  isSandbox: boolean,
  req: Express.Request,
): Promise<void> {
  const snapshot = await userCollection
    .where('likerPlus.originalTransactionId', '==', originalTransactionId)
    .get();
  await Promise.all(snapshot.docs.map(async (doc) => {
    if (doc.id === keepLikerId) return;
    const lp = (doc.data() as { likerPlus?: LikerPlusData }).likerPlus;
    // Skip records past the Plus access boundary — no live access to revoke, so
    // revoking would just emit a spurious audit log and Intercom write.
    if (!lp || !hasLivePlusAccess(lp)) return;
    // Revoke only if this grant's claim wins: strictly newer, or equal start with
    // the greater liker id as a deterministic tie-break. A newer holder is the
    // more recent owner and must be kept, so this grant yields to it.
    const holderPeriodStart = lp.currentPeriodStart || 0;
    const thisGrantWins = holderPeriodStart < keepPeriodStart
      || (holderPeriodStart === keepPeriodStart && keepLikerId > doc.id);
    if (!thisGrantWins) return;
    const revoked = await revokeIfRevenueCatOwned(doc.id, lp, isSandbox);
    if (!revoked) return;
    try {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'PlusRevenueCatDuplicateTransactionRevoke',
        originalTransactionId,
        revokedLikerId: doc.id,
        grantedLikerId: keepLikerId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }));
}

async function handleExpiration(
  event: RevenueCatEvent,
  likerId: string,
  user: { likerPlus?: LikerPlusData },
  isSandbox: boolean,
) {
  // Don't let a (possibly stale) mobile expiration revoke a record that Stripe
  // (web) currently owns. Grants always reclaim the record; terminal events do not.
  if (isStripeOwnedLikerPlus(user.likerPlus)) return;
  if (!user.likerPlus) return;
  if (isSandboxLockedOut(isSandbox, user.likerPlus)) return;
  const expiredAt = event.expiration_at_ms || Date.now();
  await revokeLikerPlus(likerId, user.likerPlus, {
    currentPeriodEnd: Math.min(user.likerPlus.currentPeriodEnd || expiredAt, expiredAt),
    subscriptionStatus: 'canceled',
  });
  if (isQuarantinedSandbox(isSandbox)) return;
  await clearIntercomPlusFlags(likerId);
  await sendIntercomEvent({ userId: likerId, eventName: 'plus_subscription_end' });
}

async function handleBillingIssue(
  likerId: string,
  user: { likerPlus?: LikerPlusData },
  isSandbox: boolean,
) {
  if (isStripeOwnedLikerPlus(user.likerPlus)) return;
  if (!user.likerPlus) return;
  if (isSandboxLockedOut(isSandbox, user.likerPlus)) return;
  if (user.likerPlus.subscriptionStatus === 'past_due') return;
  await userCollection.doc(likerId).update({
    likerPlus: {
      ...user.likerPlus,
      subscriptionStatus: 'past_due',
      provider: 'revenuecat',
    },
  });
}

// When a subscription's app_user_id changes (e.g. anonymous → logged-in, or
// account switch), RevenueCat sends a TRANSFER. Revoke from the source identities
// and let the next grant/renewal event populate the destination.
async function handleTransfer(
  event: RevenueCatEvent,
  req: Express.Request,
  isSandbox: boolean,
): Promise<void> {
  const fromIds = (event.transferred_from || []).filter((id) => id && !isAnonymousId(id));
  const toIds = (event.transferred_to || []).filter((id) => id && !isAnonymousId(id));
  await Promise.all(fromIds.map(async (likerId) => {
    const user = await getUserWithCivicLikerProperties(likerId);
    await revokeIfRevenueCatOwned(likerId, user?.likerPlus, isSandbox);
  }));
  try {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusRevenueCatTransfer',
      eventId: event.id,
      transferredFrom: fromIds,
      transferredTo: toIds,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

/**
 * Process a single RevenueCat webhook event for the Liker Plus entitlement.
 *
 * Web (Stripe) purchases are owned by the existing Stripe webhook, so events with
 * `store === 'STRIPE'` are ignored here to avoid double-writing the shared record.
 * Returns silently for events we intentionally skip; the route still replies 200 so
 * RevenueCat does not retry.
 */
export async function processRevenueCatEvent(
  event: RevenueCatEvent,
  req: Express.Request,
): Promise<void> {
  if (!event || !event.type) return;

  // RC dashboard "Send test event" — acknowledge without side effects.
  if (event.type === 'TEST') return;

  // Web subscriptions are the Stripe webhook's responsibility.
  if (event.store === 'STRIPE') return;

  // Cross-environment routing:
  //   testnet backend: only SANDBOX events are processed; PRODUCTION events are
  //     dropped (they belong to the prod deployment).
  //   prod backend: PRODUCTION events run through the normal path; SANDBOX
  //     events are accepted but quarantined — the resulting record is tagged
  //     environment:'SANDBOX' and external side effects are skipped (see
  //     isQuarantinedSandbox), and a SANDBOX event cannot mutate a non-sandbox
  //     record (see isSandboxLockedOut). This exists because App Store / Play
  //     Store reviewers exercise IAP with sandbox accounts against whichever
  //     binary they're reviewing; the long-term fix is to ship a separate
  //     testnet-pointing review build, which would let this gate go back to a
  //     strict drop.
  const isSandbox = event.environment === 'SANDBOX';
  if (!isSandbox && IS_TESTNET) return;

  // Handle TRANSFER before the isPlusEntitlement() gate below: a TRANSFER payload
  // carries no entitlement_ids/product_id, so that check would always fail and
  // silently drop every transfer. handleTransfer only revokes RevenueCat-owned
  // records, so a transfer can never cancel a Stripe-owned Plus subscription.
  if (event.type === 'TRANSFER') {
    await handleTransfer(event, req, isSandbox);
    return;
  }

  if (!isPlusEntitlement(event)) return;

  const likerId = resolveAppUserId(event);
  if (!likerId) return;

  const user = await getUserWithCivicLikerProperties(likerId);
  if (!user) {
    // eslint-disable-next-line no-console
    console.warn(`RevenueCat event ${event.type} for unknown app_user_id: ${likerId}`);
    return;
  }

  if (GRANT_EVENT_TYPES.has(event.type)) {
    await handleGrant(event, likerId, user, isSandbox, req);
  } else if (event.type === 'EXPIRATION') {
    await handleExpiration(event, likerId, user, isSandbox);
  } else if (event.type === 'BILLING_ISSUE') {
    await handleBillingIssue(likerId, user, isSandbox);
  } else if (event.type === 'CANCELLATION') {
    // Auto-renew turned off — the user keeps access until EXPIRATION. Nothing to
    // revoke; fall through to logging only.
  } else {
    // NON_RENEWING_PURCHASE, NON_SUBSCRIPTION_PURCHASE, SUBSCRIPTION_PAUSED, etc.
    return;
  }

  try {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusRevenueCatEventProcessed',
      eventType: event.type,
      eventId: event.id,
      likerId,
      store: event.store,
      productId: event.product_id,
      environment: event.environment,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export default processRevenueCatEvent;
