import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { FieldValue, userCollection } from '../../src/util/firebase';
import { ONE_DAY_IN_MS } from '../../src/constant';
import type { LikerPlusData } from '../../src/types/user';

const { mockSubscriptionRetrieve } = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: { retrieve: mockSubscriptionRetrieve },
      // Unimplemented on purpose: the invoice lookups are best-effort and swallow errors.
      invoices: {},
      paymentIntents: {},
    }),
  };
});
vi.mock('../../src/util/slack', async (importOriginal) => ({
  ...(await importOriginal() as object),
  sendPlusSubscriptionSlackNotification: vi.fn(),
}));
vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/util/api/plus/airdrop', () => ({ payPlusSubscriptionAirdrop: vi.fn() }));
vi.mock('../../src/util/api/plus/revenueShare', async (importOriginal) => ({
  ...(await importOriginal() as object),
  recordPlusSubscriptionAccrual: vi.fn(),
}));

// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_PRODUCT_ID = 'prod_plus';

// eslint-disable-next-line import/first
const {
  processStripePaymentFailure,
  processStripeSubscriptionCancellation,
  processStripeSubscriptionInvoice,
  processStripeSubscriptionStatusUpdate,
} = await import('../../src/util/api/plus');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_ownership';

async function seedLikerPlus(likerPlus: Partial<LikerPlusData>) {
  await userCollection.doc('testing').update({
    likerPlus: {
      since: Date.now() - 30 * ONE_DAY_IN_MS,
      currentPeriodStart: Date.now() - 30 * ONE_DAY_IN_MS,
      currentPeriodEnd: Date.now() + ONE_DAY_IN_MS,
      currentType: 'paid',
      subscriptionStatus: 'active',
      provider: 'stripe',
      subscriptionId: SUB_ID,
      ...likerPlus,
    },
  });
}

// The stub's reset re-reads a cached fixture, so a live record would leak into
// later files and fail their checkouts as already subscribed.
afterEach(async () => {
  await userCollection.doc('testing').update({ likerPlus: FieldValue.delete() });
});

async function readLikerPlus(): Promise<LikerPlusData> {
  const doc = await userCollection.doc('testing').get();
  return doc.data()?.likerPlus;
}

describe('Stripe cancellation', () => {
  function canceledSubscription() {
    return {
      id: SUB_ID,
      status: 'canceled',
      metadata: { evmWallet: WALLET },
      cancel_at: null,
      canceled_at: 1759000000,
      ended_at: 1759000000,
      customer: 'cus_1',
      items: { data: [{ plan: { interval: 'month' }, price: { id: 'price_plus', product: 'prod_plus' } }] },
    };
  }

  beforeEach(() => {
    mockSubscriptionRetrieve.mockReset();
  });

  it('stamps canceled on a record whose period already ended', async () => {
    await seedLikerPlus({ currentPeriodEnd: Date.now() - 60 * 1000, currentType: 'trial' });
    await processStripeSubscriptionCancellation(canceledSubscription() as never);
    expect((await readLikerPlus()).subscriptionStatus).toBe('canceled');
  });
});

describe('Stripe status writes', () => {
  const STORE_RECORD = {
    provider: 'revenuecat' as const,
    subscriptionId: undefined,
    store: 'APP_STORE',
    originalTransactionId: '410000000000001',
  };

  beforeEach(() => {
    mockSubscriptionRetrieve.mockReset();
  });

  it('leaves a store record alone on a Stripe status update', async () => {
    await seedLikerPlus(STORE_RECORD);
    await processStripeSubscriptionStatusUpdate({
      id: SUB_ID,
      status: 'past_due',
      metadata: { evmWallet: WALLET },
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
    } as never);
    expect((await readLikerPlus()).subscriptionStatus).toBe('active');
  });

  it('leaves a store record alone on a failed Stripe charge', async () => {
    await seedLikerPlus(STORE_RECORD);
    mockSubscriptionRetrieve.mockResolvedValue(null);
    await processStripePaymentFailure({
      id: 'in_failed',
      amount_due: 999,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      attempt_count: 1,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
      },
    } as never);
    expect((await readLikerPlus()).subscriptionStatus).toBe('active');
  });

  it('still marks its own record past due', async () => {
    await seedLikerPlus({});
    mockSubscriptionRetrieve.mockResolvedValue(null);
    await processStripePaymentFailure({
      id: 'in_failed_own',
      amount_due: 999,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      attempt_count: 2,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
      },
    } as never);
    expect((await readLikerPlus()).subscriptionStatus).toBe('past_due');
  });
});

describe('Stripe invoice over a store record', () => {
  const STORE_PERIOD_END = Date.now() + 31 * ONE_DAY_IN_MS;
  const PERIOD_START = Math.floor(Date.now() / 1000);

  function seedStripeSubscription() {
    mockSubscriptionRetrieve.mockResolvedValue({
      id: SUB_ID,
      status: 'active',
      start_date: PERIOD_START - 7 * 24 * 60 * 60,
      trial_end: PERIOD_START,
      metadata: { evmWallet: WALLET },
      items: {
        data: [{
          id: 'si_1',
          plan: { interval: 'month' },
          price: { id: 'price_plus_monthly', product: 'prod_plus', nickname: 'plus monthly' },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_START + 31 * 24 * 60 * 60,
        }],
      },
      customer: { id: 'cus_1', email: 'testing@likecoin.store' },
      discounts: [],
    });
  }

  function cycleInvoice() {
    return {
      id: 'in_cycle',
      amount_paid: 999,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
      },
    };
  }

  beforeEach(() => {
    mockSubscriptionRetrieve.mockReset();
  });

  // Regression: a web trial converting after an in-app purchase replaced the
  // store record, so cancelling the duplicate Stripe subscription revoked Plus.
  it('keeps a live store record', async () => {
    await seedLikerPlus({
      provider: 'revenuecat',
      subscriptionId: undefined,
      store: 'APP_STORE',
      originalTransactionId: '410000000000001',
      currentPeriodEnd: STORE_PERIOD_END,
    });
    seedStripeSubscription();
    await processStripeSubscriptionInvoice(cycleInvoice() as never, { headers: {} } as never);
    const likerPlus = await readLikerPlus();
    expect(likerPlus.provider).toBe('revenuecat');
    expect(likerPlus.originalTransactionId).toBe('410000000000001');
    expect(likerPlus.currentPeriodEnd).toBe(STORE_PERIOD_END);
  });

  it('replaces an expired store record', async () => {
    await seedLikerPlus({
      provider: 'revenuecat',
      subscriptionId: undefined,
      store: 'APP_STORE',
      currentPeriodEnd: Date.now() - ONE_DAY_IN_MS,
    });
    seedStripeSubscription();
    await processStripeSubscriptionInvoice(cycleInvoice() as never, { headers: {} } as never);
    const likerPlus = await readLikerPlus();
    expect(likerPlus.provider).toBe('stripe');
    expect(likerPlus.subscriptionId).toBe(SUB_ID);
  });
});
