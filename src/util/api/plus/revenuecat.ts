import type { LikerPlusData } from '../../../types/user';

import { IS_TESTNET, PUBSUB_TOPIC_MISC } from '../../../constant';
import { userCollection } from '../../firebase';
import { getUserWithCivicLikerProperties } from '../users/getPublicInfo';
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
  currency?: string;
  original_transaction_id?: string;
  cancel_reason?: string;
  expiration_reason?: string;
  // TRANSFER events only
  transferred_from?: string[];
  transferred_to?: string[];
}
/* eslint-enable camelcase */

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

function mapProductIdToPeriod(productId?: string): 'month' | 'year' | undefined {
  if (!productId) return undefined;
  if (monthlyProductIds.includes(productId)) return 'month';
  if (yearlyProductIds.includes(productId)) return 'year';
  return undefined;
}

function isPlusEntitlement(event: RevenueCatEvent): boolean {
  if (!REVENUECAT_PLUS_ENTITLEMENT_ID) return true;
  const ids = event.entitlement_ids
    || (event.entitlement_id ? [event.entitlement_id] : []);
  // When the entitlement list is present, require our Plus entitlement.
  if (ids.length) return ids.includes(REVENUECAT_PLUS_ENTITLEMENT_ID);
  // When entitlement info is absent, fall back to a known Plus product id so an
  // unrelated product's subscription event can't be granted Plus by mistake.
  return !!mapProductIdToPeriod(event.product_id);
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

// Prevent SANDBOX events on prod from mutating a non-sandbox record. Without
// this, an App Store reviewer (or anyone with a sandbox account) who collides
// on app_user_id with an existing paid user could clobber their real sub.
// Testnet has no production records to protect, so the guard is a no-op there.
// Mirrors the shape of isStripeOwnedLikerPlus — terminal events only revoke
// records owned by the same environment.
function isSandboxLockedOut(isSandbox: boolean, likerPlus?: LikerPlusData): boolean {
  if (!isSandbox || IS_TESTNET) return false;
  if (!likerPlus) return false;
  return likerPlus.environment !== 'SANDBOX';
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
  user: { email?: string; evmWallet?: string; likerPlus?: LikerPlusData },
  isSandbox: boolean,
) {
  if (isSandboxLockedOut(isSandbox, user.likerPlus)) return;

  const isInitial = event.type === 'INITIAL_PURCHASE';
  const isTrial = event.period_type === 'TRIAL';
  const purchasedAtMs = event.purchased_at_ms || Date.now();
  const transactionId = event.original_transaction_id || event.id;
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
  const period = mapProductIdToPeriod(event.product_id) || user.likerPlus?.period;
  const since = isInitial
    ? purchasedAtMs
    : (user.likerPlus?.since || purchasedAtMs);

  const likerPlus: LikerPlusData = {
    since,
    currentPeriodStart: purchasedAtMs,
    currentPeriodEnd,
    currentType: isTrial ? 'trial' : 'paid',
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
  await userCollection.doc(likerId).update({ likerPlus });

  // Quarantine reviewer (sandbox-on-prod) traffic out of CRM, Slack, revenue
  // analytics, and Airtable so it doesn't contaminate prod metrics. Testnet's
  // own testnet-scoped integrations still fire as usual.
  if (isQuarantinedSandbox(isSandbox)) return;

  await updateIntercomUserAttributes(likerId, {
    is_liker_plus: true,
    is_liker_plus_trial: isTrial,
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

  // Independent notifications/analytics — fire in parallel (matches the Stripe path).
  const sideEffects: Promise<unknown>[] = [
    sendPlusSubscriptionSlackNotification({
      subscriptionId: transactionId || 'N/A',
      email: user.email || 'N/A',
      priceWithCurrency: event.price != null && event.currency
        ? `${event.price.toFixed(2)} ${event.currency}`
        : 'N/A',
      isNew: isInitial,
      userId: likerId,
      method: 'revenuecat',
      isTrial,
    }),
  ];
  if (logEvent) {
    sideEffects.push(logServerEvents(logEvent, {
      email: user.email,
      evmWallet: user.evmWallet,
      value: event.price,
      currency: event.currency,
      paymentId: transactionId,
      items: period ? [{ productId: `plus-${period}ly`, quantity: 1 }] : undefined,
      extraProperties: {
        provider: 'revenuecat',
        store: event.store,
        product_id: event.product_id,
        period,
      },
    }));
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
      price: event.price,
      currency: event.currency,
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
  });
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
  const quarantine = isQuarantinedSandbox(isSandbox);
  await Promise.all(fromIds.map(async (likerId) => {
    const user = await getUserWithCivicLikerProperties(likerId);
    if (!user?.likerPlus || isStripeOwnedLikerPlus(user.likerPlus)) return;
    if (isSandboxLockedOut(isSandbox, user.likerPlus)) return;
    await revokeLikerPlus(likerId, user.likerPlus, {
      currentPeriodEnd: Date.now(),
      subscriptionStatus: 'canceled',
    });
    if (!quarantine) await clearIntercomPlusFlags(likerId);
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
    await handleGrant(event, likerId, user, isSandbox);
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
