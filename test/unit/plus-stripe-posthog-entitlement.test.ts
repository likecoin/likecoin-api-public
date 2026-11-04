import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const {
  mockSubscriptionRetrieve,
  mockLogServerEvents,
  mockSetPersonProperties,
} = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
  mockLogServerEvents: vi.fn(),
  mockSetPersonProperties: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: { retrieve: mockSubscriptionRetrieve },
      // Left unimplemented on purpose: the balance-transaction and discount
      // lookups are best-effort and swallow their own errors.
      invoices: {},
      paymentIntents: {},
    }),
  };
});

vi.mock('../../src/util/logServerEvents', () => ({ default: mockLogServerEvents }));

vi.mock('../../src/util/posthog', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, setPostHogPersonProperties: mockSetPersonProperties };
});

// eslint-disable-next-line import/first
import { userCollection } from '../../src/util/firebase';
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_PRODUCT_ID = 'prod_plus';

// eslint-disable-next-line import/first
const { processStripeSubscriptionInvoice } = await import('../../src/util/api/plus');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_entitlement';
const PERIOD_START = 1747000000;

const req = { headers: {} };

function seedSubscription() {
  mockSubscriptionRetrieve.mockResolvedValue({
    id: SUB_ID,
    status: 'active',
    start_date: PERIOD_START - 86400 * 30,
    metadata: { evmWallet: WALLET },
    items: {
      data: [{
        id: 'si_1',
        plan: { interval: 'month' },
        price: { id: 'price_plus_monthly', product: 'prod_plus' },
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_START + 86400 * 30,
      }],
    },
    customer: { id: 'cus_1', email: 'testing@likecoin.store' },
    discounts: [],
  });
}

function buildInvoice(id: string, billingReason: string, amountPaid: number) {
  return {
    id,
    amount_paid: amountPaid,
    currency: 'usd',
    billing_reason: billingReason,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
    },
  };
}

const ENTITLED = { is_liker_plus: true, liker_plus_tier: 'plus' };

describe('Stripe invoice PostHog entitlement writes', () => {
  beforeEach(() => {
    mockSubscriptionRetrieve.mockReset();
    mockLogServerEvents.mockReset();
    mockSetPersonProperties.mockReset();
    seedSubscription();
  });

  it('re-asserts the entitlement on a paid renewal event', async () => {
    await processStripeSubscriptionInvoice(
      buildInvoice('in_entitlement_renewal', 'subscription_cycle', 999) as never,
      req as never,
    );
    const renewal = mockLogServerEvents.mock.calls.find(([event]) => event === 'SubscriptionRenewed');
    expect(renewal?.[1].set).toEqual(ENTITLED);
    expect(mockSetPersonProperties).not.toHaveBeenCalled();
  });

  it('writes the entitlement directly when the invoice emits no event', async () => {
    await processStripeSubscriptionInvoice(
      buildInvoice('in_entitlement_update', 'subscription_update', 500) as never,
      req as never,
    );
    expect(mockLogServerEvents).not.toHaveBeenCalled();
    expect(mockSetPersonProperties).toHaveBeenCalledWith({
      evmWallet: WALLET,
      likeWallet: undefined,
      properties: ENTITLED,
    });
  });

  it('keeps the tier of a live app record the charge does not replace', async () => {
    await userCollection.doc('testing').update({
      likerPlus: {
        tier: 'civic',
        provider: 'revenuecat',
        subscriptionStatus: 'active',
        currentPeriodStart: Date.now() - 86400000,
        currentPeriodEnd: Date.now() + 86400000 * 30,
      },
    });
    await processStripeSubscriptionInvoice(
      buildInvoice('in_entitlement_app_held', 'subscription_cycle', 999) as never,
      req as never,
    );
    const renewal = mockLogServerEvents.mock.calls.find(([event]) => event === 'SubscriptionRenewed');
    expect(renewal?.[1].set).toEqual({ is_liker_plus: true, liker_plus_tier: 'civic' });
  });
});
