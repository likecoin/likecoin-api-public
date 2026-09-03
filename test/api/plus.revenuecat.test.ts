import {
  describe, it, expect, vi,
} from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import { getUserWithCivicLikerProperties } from '../../src/util/api/users/getPublicInfo';
import { userCollection } from '../../src/util/firebase';
import { sendPlusSubscriptionSlackNotification } from '../../src/util/slack';
import { sendIntercomEvent } from '../../src/util/intercom';
import logServerEvents from '../../src/util/logServerEvents';

// Override only the Slack post so the notification gate is observable: the real
// helper early-returns on an unset webhook, so it silently passes either way.
vi.mock('../../src/util/slack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/slack')>();
  return {
    ...actual,
    sendPlusSubscriptionSlackNotification: vi.fn(),
  };
});
const mockSlackNotification = vi.mocked(sendPlusSubscriptionSlackNotification);

// Same reason as Slack: both helpers swallow their own errors and return, so which
// lifecycle event fired is only observable through a spy. Kept file-local rather than
// in setup.ts because a suite-wide mock would silence these calls for every other
// test file, not just the ones asserting on them.
// Resolves rather than returning undefined: the real emit is async, and callers
// chain .catch() on it.
vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
const mockLogServerEvents = vi.mocked(logServerEvents);

vi.mock('../../src/util/intercom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/intercom')>();
  return { ...actual, sendIntercomEvent: vi.fn() };
});
const mockIntercomEvent = vi.mocked(sendIntercomEvent);

const WEBHOOK_PATH = '/api/plus/revenuecat/webhook';
const AUTH = 'test-rc-webhook-secret'; // matches REVENUECAT_WEBHOOK_AUTHORIZATION in test/setup.ts

const PURCHASED_AT_MS = 1747000000000;
const EXPIRATION_AT_MS = 1778536000000;
// A prior holder from an earlier billing period than the incoming grant, so the
// grant's newest-wins dedupe revokes it (rather than yielding to a newer owner).
const PRIOR_PERIOD_START_MS = PURCHASED_AT_MS - 30 * 24 * 60 * 60 * 1000;
// EXPIRATION_AT_MS is in the past, so guards keyed on live access need their own end.
const FUTURE_PERIOD_END_MS = Date.now() + 30 * 24 * 60 * 60 * 1000;
// Period start of the trial→paid renewal, one 7-day trial term after the purchase.
const CONVERSION_START_MS = PURCHASED_AT_MS + 7 * 24 * 60 * 60 * 1000;

// A live, RevenueCat-owned APP_STORE record — the shape the subscription-scoping
// and transfer-carry guards operate on. Spread it so tests can't share a reference.
const liveAppStorePlus = {
  since: PURCHASED_AT_MS,
  currentPeriodStart: PURCHASED_AT_MS,
  currentPeriodEnd: FUTURE_PERIOD_END_MS,
  currentType: 'paid',
  subscriptionStatus: 'active',
  provider: 'revenuecat',
  store: 'APP_STORE',
  originalTransactionId: 'txn_123',
};

function rcBody(event: Record<string, unknown>) {
  return { api_version: '1.0', event };
}

// environment must be SANDBOX because IS_TESTNET is set in tests.
const baseEvent = {
  id: 'evt_1',
  app_user_id: 'testing',
  entitlement_ids: ['plus'],
  product_id: 'rc_plus_yearly',
  period_type: 'NORMAL',
  purchased_at_ms: PURCHASED_AT_MS,
  expiration_at_ms: EXPIRATION_AT_MS,
  store: 'APP_STORE',
  environment: 'SANDBOX',
  original_transaction_id: 'txn_123',
};

const post = (event: Record<string, unknown>, headers?: Record<string, string>) => axiosist
  .post(WEBHOOK_PATH, rcBody(event), headers ? { headers } : undefined)
  .catch((err) => (err as any).response);

describe('Plus RevenueCat webhook', () => {
  it('rejects requests without a valid Authorization header', async () => {
    const noAuth = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await post(
      { ...baseEvent, type: 'INITIAL_PURCHASE' },
      { Authorization: 'wrong-secret' },
    );
    expect(wrongAuth.status).toBe(401);
  });

  it('activates Plus on INITIAL_PURCHASE and tags provider=revenuecat', async () => {
    mockSlackNotification.mockClear();
    const res = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
    expect(mockSlackNotification).toHaveBeenCalledTimes(1);

    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus).toBeTruthy();
    expect(user?.likerPlus?.provider).toBe('revenuecat');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
    expect(user?.likerPlus?.currentType).toBe('paid');
    expect(user?.likerPlus?.period).toBe('year');
    expect(user?.likerPlus?.store).toBe('APP_STORE');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(EXPIRATION_AT_MS);
  });

  it('forwards first-touch subscriber attributes, dropping cleared ones', async () => {
    // The app sets initialUtm* as RevenueCat subscriber attributes before purchase.
    // They are sticky per subscriber and cannot be retracted, so a cleared attribute
    // arrives as the empty-string tombstone and must read as absent, not as ''.
    mockLogServerEvents.mockClear();
    const res = await post(
      {
        ...baseEvent,
        type: 'INITIAL_PURCHASE',
        subscriber_attributes: {
          initialUtmSource: { value: 'facebookads' },
          initialUtmCampaign: { value: 'launch' },
          initialUtmMedium: { value: '' },
          utmSource: { value: 'newsletter' },
        },
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    expect(mockLogServerEvents).toHaveBeenCalledWith(
      'PlusAcquisition',
      expect.objectContaining({
        extraProperties: expect.objectContaining({
          initial_utm_source: 'facebookads',
          initial_utm_campaign: 'launch',
          initial_utm_medium: undefined,
          utm_source: 'newsletter',
        }),
      }),
    );
  });

  it('tags the record with environment=SANDBOX for sandbox events', async () => {
    // Sandbox-on-prod is quarantined by tagging the record so dashboards can
    // filter out reviewer traffic. Testnet records carry the same tag since
    // every event there is SANDBOX — that's accurate, not a side effect.
    const res = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.environment).toBe('SANDBOX');
  });

  it('marks trial subscriptions with currentType=trial', async () => {
    const res = await post(
      { ...baseEvent, type: 'INITIAL_PURCHASE', period_type: 'TRIAL' },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.currentType).toBe('trial');
  });

  it('books a paid introductory offer as a trial but keeps its charge', async () => {
    // The $1/7-day promo arrives as period_type INTRO, not TRIAL. It must read as a
    // trial for entitlement/CRM/analytics (Stripe parity, where the same promo is a
    // trialing subscription) while its real charge still funds nothing in rev-share.
    mockSlackNotification.mockClear();
    const res = await post(
      {
        ...baseEvent, type: 'INITIAL_PURCHASE', period_type: 'INTRO', price: 1,
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.currentType).toBe('trial');
    expect(user?.likerPlus?.dailyValue).toBe(0);
    expect(mockSlackNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        isTrial: true,
        isNew: true,
        // The $1 is a real charge and must still be reported, unlike a free trial's 0.
        priceWithCurrency: '1.00 USD',
      }),
    );
  });

  it('reports the first charge after a trial as a new subscription, not a renewal', async () => {
    // RevenueCat's is_trial_conversion stays false for a paid intro, so the conversion
    // is detected from the stored record's currentType instead.
    mockSlackNotification.mockClear();
    await userCollection.doc('testing').update({
      likerPlus: { ...liveAppStorePlus, currentType: 'trial' },
    });
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_convert',
        type: 'RENEWAL',
        period_type: 'NORMAL',
        price: 49,
        // Its own period start: the accrual key is `${transaction}_${periodStart}`, and
        // reusing PURCHASED_AT_MS would seed the doc a later test asserts is absent.
        purchased_at_ms: CONVERSION_START_MS,
      },
      { Authorization: AUTH },
    );
    try {
      expect(res.status).toBe(200);
      const user = await getUserWithCivicLikerProperties('testing');
      expect(user?.likerPlus?.currentType).toBe('paid');
      expect(mockSlackNotification).toHaveBeenCalledWith(
        expect.objectContaining({ isTrial: false, isNew: true }),
      );
    } finally {
      // This is the only test booking a real charge, so the only one writing a rev-share
      // accrual. The Firestore stub is shared across test files and plus-settle's "no
      // accrual" dry run would pick this up, so drop it even when an assertion fails.
      await userCollection.doc('testing')
        .collection('plusReadingAccrual')
        .doc(`txn_123_${CONVERSION_START_MS}`)
        .delete();
    }
  });

  it('skips the grant when a subscription event has no resolvable period end', async () => {
    // The in-memory stub persists writes across tests, so force a clean record first.
    await userCollection.doc('testing').update({ likerPlus: null });
    // A malformed grant with no expiration_at_ms (and no prior record) must not
    // write an active-but-expired record (currentPeriodEnd 0 reads as expired).
    const res = await post(
      { ...baseEvent, type: 'INITIAL_PURCHASE', expiration_at_ms: null },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus).toBeFalsy();
  });

  it('ignores STRIPE-store events (owned by the existing Stripe webhook)', async () => {
    const res = await post(
      {
        ...baseEvent, app_user_id: 'testuser', type: 'INITIAL_PURCHASE', store: 'STRIPE',
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testuser');
    expect(user?.likerPlus).toBeFalsy();
  });

  it('does not grant Plus for an unrelated product when no entitlement is present', async () => {
    await userCollection.doc('testing').update({ likerPlus: null });
    // No entitlement info + a product id outside REVENUECAT_PLUS_*_PRODUCT_IDS must
    // not be treated as Plus, otherwise any subscription event would grant access.
    const res = await post(
      {
        ...baseEvent,
        type: 'INITIAL_PURCHASE',
        entitlement_ids: null,
        product_id: 'rc_unrelated_product',
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus).toBeFalsy();
  });

  it('revokes access on EXPIRATION and caps currentPeriodEnd', async () => {
    await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    const res = await post(
      {
        ...baseEvent, id: 'evt_2', type: 'EXPIRATION', expiration_at_ms: PURCHASED_AT_MS + 1000,
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('canceled');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(PURCHASED_AT_MS + 1000);
  });

  it('reports a churned paid intro as a trial end, not a cancellation', async () => {
    // A $1/7-day intro the user cancelled lapses as an EXPIRATION whose period_type
    // is INTRO. currentType on the record is what makes it a trial end — Stripe parity.
    await userCollection.doc('testing').update({
      likerPlus: { ...liveAppStorePlus, currentType: 'trial', period: 'year' },
    });
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_intro_expire',
        type: 'EXPIRATION',
        period_type: 'INTRO',
        expiration_reason: 'UNSUBSCRIBED',
        expiration_at_ms: Date.now(),
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('canceled');
    expect(mockIntercomEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'plus_trial_end' }),
    );
    expect(mockLogServerEvents).toHaveBeenCalledWith(
      'TrialEnded',
      expect.objectContaining({
        // Must match the id the grant reported, or the funnel doesn't join up.
        paymentId: 'txn_123',
        extraProperties: expect.objectContaining({
          subscription_id: 'txn_123',
          provider: 'revenuecat',
          is_paid_trial: true,
          cancel_reason: 'UNSUBSCRIBED',
          period: 'year',
        }),
      }),
    );
    // Churn carries no value/currency, which is what keeps it out of Meta/GA as a
    // conversion — logServerEvents returns before those when either is missing.
    expect(mockLogServerEvents).toHaveBeenCalledTimes(1);
    const [, options] = mockLogServerEvents.mock.calls[0];
    expect(options.value).toBeUndefined();
    expect(options.currency).toBeUndefined();
  });

  it('reports an expired paid subscription as a cancellation', async () => {
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    const res = await post(
      {
        ...baseEvent, id: 'evt_paid_expire', type: 'EXPIRATION', expiration_at_ms: Date.now(),
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    expect(mockIntercomEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'plus_subscription_end' }),
    );
    expect(mockLogServerEvents).toHaveBeenCalledWith(
      'SubscriptionCancelled',
      expect.objectContaining({
        extraProperties: expect.objectContaining({ is_paid_trial: false }),
      }),
    );
  });

  it('does not revoke a legacy Stripe-owned record (no provider) on EXPIRATION', async () => {
    // Pre-PR Stripe subscribers have subscriptionId/customerId but no provider.
    await userCollection.doc('testing').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: EXPIRATION_AT_MS,
        currentType: 'paid',
        subscriptionStatus: 'active',
        subscriptionId: 'sub_legacy',
        customerId: 'cus_legacy',
      },
    });
    const res = await post(
      { ...baseEvent, type: 'EXPIRATION', expiration_at_ms: PURCHASED_AT_MS + 1000 },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(EXPIRATION_AT_MS);
    expect(user?.likerPlus?.subscriptionId).toBe('sub_legacy');
  });

  it('does not revoke a paid store subscription when an unrelated promotional entitlement expires', async () => {
    // A promotional entitlement revoked from the RevenueCat dashboard emits
    // CANCELLATION + EXPIRATION with store PROMOTIONAL and no original_transaction_id.
    // It must not collapse the live APP_STORE record it shares `likerPlus` with.
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    const promoExpiry: Record<string, unknown> = {
      ...baseEvent,
      id: 'evt_promo_expire',
      type: 'EXPIRATION',
      store: 'PROMOTIONAL',
      product_id: 'rc_promo_plus_daily',
      expiration_at_ms: Date.now(),
    };
    delete promoExpiry.original_transaction_id;
    const res = await post(promoExpiry, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(FUTURE_PERIOD_END_MS);
  });

  it('does not revoke on EXPIRATION naming a different original_transaction_id', async () => {
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_other_txn',
        type: 'EXPIRATION',
        original_transaction_id: 'txn_other',
        expiration_at_ms: Date.now(),
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(FUTURE_PERIOD_END_MS);
  });

  it('sets past_due on BILLING_ISSUE and emits PaymentFailed', async () => {
    await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    mockLogServerEvents.mockClear();
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_3',
        type: 'BILLING_ISSUE',
        grace_period_expiration_at_ms: EXPIRATION_AT_MS,
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('past_due');
    expect(mockLogServerEvents).toHaveBeenCalledWith(
      'PaymentFailed',
      expect.objectContaining({
        // The event id, not the transaction id — a stable paymentId would let
        // PostHog dedupe a later billing issue on the same subscription.
        paymentId: 'evt_3',
        extraProperties: expect.objectContaining({
          subscription_id: 'txn_123',
          provider: 'revenuecat',
          platform: 'app',
          store: 'APP_STORE',
          tier: 'plus',
          period: 'year',
          grace_period_expires_at: EXPIRATION_AT_MS,
        }),
      }),
    );
    // Churn signals are PostHog-only; value/currency would forward them to Meta/GA.
    expect(mockLogServerEvents).toHaveBeenCalledTimes(1);
    const [, options] = mockLogServerEvents.mock.calls[0];
    expect(options.value).toBeUndefined();
    expect(options.currency).toBeUndefined();
  });

  it('emits PaymentFailed once across redelivered BILLING_ISSUE events', async () => {
    // The stores re-notify on every failed attempt; only the first moves the record.
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    await post({ ...baseEvent, id: 'evt_dun_1', type: 'BILLING_ISSUE' }, { Authorization: AUTH });
    mockLogServerEvents.mockClear();
    const res = await post(
      { ...baseEvent, id: 'evt_dun_2', type: 'BILLING_ISSUE' },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    expect(mockLogServerEvents).not.toHaveBeenCalledWith('PaymentFailed', expect.anything());
  });

  it('does not emit PaymentFailed for a Stripe-owned record', async () => {
    await userCollection.doc('testing').update({
      likerPlus: { ...liveAppStorePlus, provider: 'stripe', subscriptionId: 'sub_1' },
    });
    mockLogServerEvents.mockClear();
    const res = await post(
      { ...baseEvent, id: 'evt_dun_stripe', type: 'BILLING_ISSUE' },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    expect(mockLogServerEvents).not.toHaveBeenCalledWith('PaymentFailed', expect.anything());
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
  });

  it('does not set past_due on BILLING_ISSUE for a different subscription', async () => {
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_billing_other',
        type: 'BILLING_ISSUE',
        original_transaction_id: 'txn_other',
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
  });

  it('revokes a RevenueCat-owned record for transferred_from users on TRANSFER', async () => {
    await userCollection.doc('testing').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: EXPIRATION_AT_MS,
        currentType: 'paid',
        subscriptionStatus: 'active',
        provider: 'revenuecat',
      },
    });
    // TRANSFER payloads carry no entitlement_ids/product_id (per RevenueCat docs).
    const res = await post(
      {
        id: 'evt_transfer',
        type: 'TRANSFER',
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transferred_from: ['testing'],
        transferred_to: ['testuser'],
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('canceled');
    expect(user?.likerPlus?.provider).toBe('revenuecat');
  });

  it('does not revoke a Stripe-owned record on TRANSFER', async () => {
    await userCollection.doc('testing').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: EXPIRATION_AT_MS,
        currentType: 'paid',
        subscriptionStatus: 'active',
        subscriptionId: 'sub_legacy',
        customerId: 'cus_legacy',
      },
    });
    const res = await post(
      {
        id: 'evt_transfer2',
        type: 'TRANSFER',
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transferred_from: ['testing'],
        transferred_to: ['testuser'],
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.subscriptionStatus).toBe('active');
    expect(user?.likerPlus?.subscriptionId).toBe('sub_legacy');
  });

  it('preserves dailyValue on a SUBSCRIPTION_EXTENDED that reports price 0', async () => {
    // Play sends `price: 0` on a store-granted extension rather than omitting the
    // field, so a presence check reads it as a real charge and recomputes dailyValue
    // to 0 — zeroing rev-share funding for the rest of the term.
    const extendedEnd = FUTURE_PERIOD_END_MS + 24 * 60 * 60 * 1000;
    mockSlackNotification.mockClear();
    await userCollection.doc('testing').update({
      likerPlus: { ...liveAppStorePlus, dailyValue: 0.37, dailyValueCurrency: 'USD' },
    });
    const res = await post(
      {
        ...baseEvent,
        id: 'evt_extended',
        type: 'SUBSCRIPTION_EXTENDED',
        store: 'PLAY_STORE',
        price: 0,
        price_in_purchased_currency: 0,
        currency: 'GBP',
        expiration_at_ms: extendedEnd,
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);

    const user = await getUserWithCivicLikerProperties('testing');
    expect(user?.likerPlus?.currentPeriodEnd).toBe(extendedEnd);
    expect(user?.likerPlus?.dailyValue).toBe(0.37);

    // Preserving dailyValue makes the accrual gate rest solely on hasCharge: an extend
    // reuses the running term's key, so accruing would re-fund it over a longer span.
    const accrual = await userCollection.doc('testing')
      .collection('plusReadingAccrual')
      .doc(`txn_123_${PURCHASED_AT_MS}`)
      .get();
    expect(accrual.exists).toBe(false);

    // Nothing was bought, so announcing one posts a "renewal … 0.00 GBP" that reads
    // as a real sale.
    expect(mockSlackNotification).not.toHaveBeenCalled();
  });

  it('carries a live subscription to transferred_to on TRANSFER', async () => {
    // A pure account switch (log into a new account days after buying) emits only
    // TRANSFER — no grant event follows — so the destination must be populated from
    // the source record or it holds no Plus until the next RENEWAL.
    await userCollection.doc('testing').update({
      likerPlus: {
        ...liveAppStorePlus, dailyValue: 0.43, dailyValueCurrency: 'USD', period: 'month',
      },
    });
    await userCollection.doc('testuser').update({ likerPlus: null });
    const res = await post(
      {
        id: 'evt_transfer_carry',
        type: 'TRANSFER',
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transferred_from: ['$RCAnonymousID:abc', 'testing'],
        transferred_to: ['testuser'],
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);

    const destination = await getUserWithCivicLikerProperties('testuser');
    expect(destination?.likerPlus?.subscriptionStatus).toBe('active');
    expect(destination?.likerPlus?.provider).toBe('revenuecat');
    expect(destination?.likerPlus?.currentPeriodEnd).toBe(FUTURE_PERIOD_END_MS);
    expect(destination?.likerPlus?.currentPeriodStart).toBe(PURCHASED_AT_MS);
    expect(destination?.likerPlus?.since).toBe(PURCHASED_AT_MS);
    expect(destination?.likerPlus?.originalTransactionId).toBe('txn_123');
    expect(destination?.likerPlus?.store).toBe('APP_STORE');
    expect(destination?.likerPlus?.period).toBe('month');
    expect(destination?.likerPlus?.dailyValue).toBe(0.43);

    // The source still loses access — the subscription moved, it wasn't copied.
    const origin = await getUserWithCivicLikerProperties('testing');
    expect(origin?.likerPlus?.subscriptionStatus).toBe('canceled');
    expect((origin?.likerPlus?.currentPeriodEnd || 0)).toBeLessThanOrEqual(Date.now());
  });

  it('does not carry an already-expired source record on TRANSFER', async () => {
    await userCollection.doc('testing').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: EXPIRATION_AT_MS, // in the past
        currentType: 'paid',
        subscriptionStatus: 'canceled',
        provider: 'revenuecat',
      },
    });
    await userCollection.doc('testuser').update({ likerPlus: null });
    const res = await post(
      {
        id: 'evt_transfer_expired',
        type: 'TRANSFER',
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transferred_from: ['testing'],
        transferred_to: ['testuser'],
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const destination = await getUserWithCivicLikerProperties('testuser');
    expect(destination?.likerPlus).toBeFalsy();
  });

  it('does not overwrite a destination that already has live access on TRANSFER', async () => {
    // Clobbering would discard the Stripe-owned record's subscriptionId/customerId,
    // which RevenueCat cannot restore, and the user already has access either way.
    await userCollection.doc('testing').update({ likerPlus: { ...liveAppStorePlus } });
    await userCollection.doc('testuser').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: FUTURE_PERIOD_END_MS,
        currentType: 'paid',
        subscriptionStatus: 'active',
        subscriptionId: 'sub_stripe',
        customerId: 'cus_stripe',
      },
    });
    const res = await post(
      {
        id: 'evt_transfer_occupied',
        type: 'TRANSFER',
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transferred_from: ['testing'],
        transferred_to: ['testuser'],
      },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
    const destination = await getUserWithCivicLikerProperties('testuser');
    expect(destination?.likerPlus?.subscriptionId).toBe('sub_stripe');
    expect(destination?.likerPlus?.originalTransactionId).toBeFalsy();
  });

  it('revokes a prior Liker ID that holds Plus tied to the same original_transaction_id on grant', async () => {
    // Simulates: same iOS/Play subscription previously granted Plus to Liker A
    // (via missed TRANSFER, Family Sharing, etc.); a fresh grant for Liker B
    // must revoke A so only one Liker ID holds the entitlement at a time.
    // currentPeriodEnd must be in the future or the helper treats the record as
    // already-expired and skips the revoke. The prior holder is an earlier
    // period so the grant's newest-wins dedupe revokes it.
    const futureEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await userCollection.doc('testuser').update({
      likerPlus: {
        since: PRIOR_PERIOD_START_MS,
        currentPeriodStart: PRIOR_PERIOD_START_MS,
        currentPeriodEnd: futureEnd,
        currentType: 'paid',
        subscriptionStatus: 'active',
        provider: 'revenuecat',
        originalTransactionId: 'txn_123',
      },
    });
    const res = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const granted = await getUserWithCivicLikerProperties('testing');
    expect(granted?.likerPlus?.subscriptionStatus).toBe('active');
    expect(granted?.likerPlus?.originalTransactionId).toBe('txn_123');
    const revoked = await getUserWithCivicLikerProperties('testuser');
    expect(revoked?.likerPlus?.subscriptionStatus).toBe('canceled');
    expect((revoked?.likerPlus?.currentPeriodEnd || 0)).toBeLessThanOrEqual(Date.now());
  });

  it('does not revoke a Stripe-owned prior holder of the same original_transaction_id', async () => {
    // currentPeriodEnd must be in the future or the dedupe treats the record as
    // already-expired and returns before reaching the Stripe-owned guard. An
    // earlier period start keeps the newest-wins guard from short-circuiting so
    // the Stripe-owned protection is what spares this holder.
    const futureEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await userCollection.doc('testuser').update({
      likerPlus: {
        since: PRIOR_PERIOD_START_MS,
        currentPeriodStart: PRIOR_PERIOD_START_MS,
        currentPeriodEnd: futureEnd,
        currentType: 'paid',
        subscriptionStatus: 'active',
        subscriptionId: 'sub_stripe',
        customerId: 'cus_stripe',
        originalTransactionId: 'txn_123',
      },
    });
    const res = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const stripeHolder = await getUserWithCivicLikerProperties('testuser');
    expect(stripeHolder?.likerPlus?.subscriptionStatus).toBe('active');
    expect(stripeHolder?.likerPlus?.subscriptionId).toBe('sub_stripe');
  });

  it('does not revoke a holder whose period is newer than the incoming grant', async () => {
    // Newest-wins: a holder with a later currentPeriodStart is the more recent
    // owner, so an older grant must yield to it rather than revoke it. This is
    // what makes concurrent same-transaction grants converge on one survivor
    // instead of mutually revoking.
    const newerStart = PURCHASED_AT_MS + 30 * 24 * 60 * 60 * 1000;
    const newerEnd = Date.now() + 60 * 24 * 60 * 60 * 1000;
    await userCollection.doc('testuser').update({
      likerPlus: {
        since: newerStart,
        currentPeriodStart: newerStart,
        currentPeriodEnd: newerEnd,
        currentType: 'paid',
        subscriptionStatus: 'active',
        provider: 'revenuecat',
        originalTransactionId: 'txn_123',
      },
    });
    const res = await post({ ...baseEvent, type: 'INITIAL_PURCHASE' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const newerHolder = await getUserWithCivicLikerProperties('testuser');
    expect(newerHolder?.likerPlus?.subscriptionStatus).toBe('active');
    expect(newerHolder?.likerPlus?.currentPeriodStart).toBe(newerStart);
  });

  it('does not touch other holders when the grant event has no original_transaction_id', async () => {
    await userCollection.doc('testuser').update({
      likerPlus: {
        since: PURCHASED_AT_MS,
        currentPeriodStart: PURCHASED_AT_MS,
        currentPeriodEnd: EXPIRATION_AT_MS,
        currentType: 'paid',
        subscriptionStatus: 'active',
        provider: 'revenuecat',
        originalTransactionId: 'txn_other',
      },
    });
    const eventWithoutTxn: Record<string, unknown> = { ...baseEvent, type: 'INITIAL_PURCHASE' };
    delete eventWithoutTxn.original_transaction_id;
    const res = await post(eventWithoutTxn, { Authorization: AUTH });
    expect(res.status).toBe(200);
    const untouched = await getUserWithCivicLikerProperties('testuser');
    expect(untouched?.likerPlus?.subscriptionStatus).toBe('active');
  });

  it('returns 200 for an unknown app_user_id without writing', async () => {
    const res = await post(
      { ...baseEvent, app_user_id: 'nonexistent-user', type: 'INITIAL_PURCHASE' },
      { Authorization: AUTH },
    );
    expect(res.status).toBe(200);
  });

  it('acknowledges TEST events with 200', async () => {
    const res = await post({ ...baseEvent, type: 'TEST' }, { Authorization: AUTH });
    expect(res.status).toBe(200);
  });

  it('exposes the canonical app_user_id via GET /config', async () => {
    // No JWT → expect auth rejection rather than a 200 payload.
    const noJwt = await axiosist
      .get('/api/plus/revenuecat/config')
      .catch((err) => (err as any).response);
    expect(noJwt.status).toBe(401);

    // With a valid JWT, returns the caller's user id and configured entitlement.
    const token = jwtSign({ user: 'testing' });
    const res = await axiosist.get('/api/plus/revenuecat/config', {
      headers: {
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ appUserId: 'testing', entitlementId: 'plus' });
  });
});
