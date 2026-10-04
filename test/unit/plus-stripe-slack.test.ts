import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { userCollection } from '../../src/util/firebase';

const {
  mockSubscriptionRetrieve,
  mockSlackNotification,
  mockLogServerEvents,
} = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
  mockSlackNotification: vi.fn(),
  mockLogServerEvents: vi.fn(),
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
  sendPlusSubscriptionSlackNotification: mockSlackNotification,
}));
vi.mock('../../src/util/logServerEvents', () => ({ default: mockLogServerEvents }));
// A paid invoice would otherwise attempt a LIKE transfer,
// and its rev-share accrual would outlive this file in the shared Firestore stub.
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
const { processStripeSubscriptionInvoice } = await import('../../src/util/api/plus');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_slack';
const START_DATE = 1747000000;
const TRIAL_END = START_DATE + 7 * 24 * 60 * 60;
const PERIOD_START = TRIAL_END + 365 * 24 * 60 * 60;

const req = { headers: {} };

function seedSubscription({ trialEnd = null as number | null, periodStart = PERIOD_START } = {}) {
  mockSubscriptionRetrieve.mockResolvedValue({
    id: SUB_ID,
    status: 'active',
    start_date: START_DATE,
    trial_end: trialEnd,
    metadata: { evmWallet: WALLET },
    items: {
      data: [{
        id: 'si_1',
        plan: { interval: 'year' },
        price: { id: 'price_plus_yearly', product: 'prod_plus', nickname: 'plus yearly' },
        current_period_start: periodStart,
        current_period_end: periodStart + 365 * 24 * 60 * 60,
      }],
    },
    customer: { id: 'cus_1', email: 'testing@likecoin.store' },
    discounts: [],
  });
}

function cycleInvoice(id: string) {
  return {
    id,
    amount_paid: 6999,
    currency: 'usd',
    billing_reason: 'subscription_cycle',
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
    },
  };
}

describe('Plus Stripe Slack notifications', () => {
  beforeEach(async () => {
    mockSubscriptionRetrieve.mockReset();
    mockSlackNotification.mockReset();
    mockLogServerEvents.mockReset().mockResolvedValue(undefined);
    // The same subscription already on record, so the invoice is not a new one.
    await userCollection.doc('testing').update({
      likerPlus: {
        since: START_DATE * 1000,
        currentType: 'paid',
        provider: 'stripe',
        subscriptionId: SUB_ID,
      },
    });
  });

  it('does not announce a plain renewal', async () => {
    seedSubscription();
    await processStripeSubscriptionInvoice(cycleInvoice('in_renewal') as never, req as never);
    expect(mockLogServerEvents).toHaveBeenCalledWith('SubscriptionRenewed', expect.anything());
    expect(mockSlackNotification).not.toHaveBeenCalled();
  });

  it('still announces the first charge after a trial', async () => {
    seedSubscription({ trialEnd: TRIAL_END, periodStart: TRIAL_END });
    await processStripeSubscriptionInvoice(cycleInvoice('in_conversion') as never, req as never);
    expect(mockSlackNotification).toHaveBeenCalledTimes(1);
  });
});
