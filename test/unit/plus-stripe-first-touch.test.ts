import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const {
  mockSessionCreate,
  mockSubscriptionRetrieve,
  mockLogServerEvents,
} = vi.hoisted(() => ({
  mockSessionCreate: vi.fn(),
  mockSubscriptionRetrieve: vi.fn(),
  mockLogServerEvents: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: { sessions: { create: mockSessionCreate } },
      subscriptions: { retrieve: mockSubscriptionRetrieve },
      // Left unimplemented on purpose: the balance-transaction and discount
      // lookups are best-effort and swallow their own errors.
      invoices: {},
      paymentIntents: {},
    }),
  };
});

vi.mock('../../src/util/logServerEvents', () => ({ default: mockLogServerEvents }));

// Mutate the real config singleton rather than mocking config/config, which would
// turn it into a strict-ESM module and break consumers reading unset keys.
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_PRODUCT_ID = 'prod_plus';
cfg.LIKER_PLUS_MONTHLY_PRICE_ID = 'price_plus_monthly';
cfg.LIKER_PLUS_YEARLY_PRICE_ID = 'price_plus_yearly';

// eslint-disable-next-line import/first
const {
  createNewPlusCheckoutSession,
  processStripeSubscriptionInvoice,
} = await import('../../src/util/api/plus');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_first_touch';

const req = { headers: {}, user: { user: 'testing', wallet: WALLET, evmWallet: WALLET } };

// First-touch as it lands in Stripe subscription metadata at checkout time. This is
// the only copy for a web trial: the client success-page event often never fires, so
// the webhook below is the sole source of the attribution on those conversions.
const SUB_METADATA = {
  evmWallet: WALLET,
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaign: 'aug-push',
  initialUtmSource: 'facebookads',
  initialUtmMedium: 'paid_social',
  initialUtmCampaign: 'launch',
  from: 'plus-modal',
};

function seedSubscription() {
  mockSubscriptionRetrieve.mockResolvedValue({
    id: SUB_ID,
    status: 'trialing',
    start_date: 1747000000,
    metadata: SUB_METADATA,
    items: {
      data: [{
        id: 'si_1',
        plan: { interval: 'year' },
        price: { id: 'price_plus_yearly', product: 'prod_plus' },
      }],
    },
    customer: { id: 'cus_1', email: 'testing@likecoin.store' },
    discounts: [],
  });
}

const invoice = {
  id: 'in_first_touch',
  amount_paid: 0,
  currency: 'usd',
  billing_reason: 'subscription_create',
  parent: {
    type: 'subscription_details',
    subscription_details: { subscription: SUB_ID, metadata: SUB_METADATA },
  },
};

describe('Plus first-touch attribution round-trip through Stripe', () => {
  beforeEach(() => {
    mockSessionCreate.mockReset();
    mockSubscriptionRetrieve.mockReset();
    mockLogServerEvents.mockReset();
  });

  it('writes first-touch into the subscription metadata at checkout', async () => {
    mockSessionCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/cs_1' });
    await createNewPlusCheckoutSession(
      { period: 'yearly' },
      {
        utm: { source: 'newsletter', medium: 'email', campaign: 'aug-push' },
        initialUtm: { source: 'facebookads', medium: 'paid_social', campaign: 'launch' },
      },
      req,
    );
    const [payload] = mockSessionCreate.mock.calls[0];
    // Must be on subscription_data, not just the session: the webhook reads the
    // subscription's metadata, which a session-only key never reaches.
    expect(payload.subscription_data.metadata).toMatchObject({
      utmSource: 'newsletter',
      initialUtmSource: 'facebookads',
      initialUtmMedium: 'paid_social',
      initialUtmCampaign: 'launch',
    });
  });

  it('omits first-touch keys when the client sent none', async () => {
    mockSessionCreate.mockResolvedValue({ id: 'cs_2', url: 'https://stripe.test/cs_2' });
    await createNewPlusCheckoutSession(
      { period: 'yearly' },
      { utm: { source: 'newsletter' } },
      req,
    );
    const [payload] = mockSessionCreate.mock.calls[0];
    expect(payload.subscription_data.metadata).not.toHaveProperty('initialUtmSource');
  });

  it('emits first-touch on the acquisition events from the invoice webhook', async () => {
    seedSubscription();
    await processStripeSubscriptionInvoice(invoice as never, req as never);
    const emitted = mockLogServerEvents.mock.calls.map(([event]) => event);
    expect(emitted).toContain('StartTrial');
    expect(emitted).toContain('PlusAcquisition');
    mockLogServerEvents.mock.calls.forEach(([, options]) => {
      expect(options.extraProperties).toMatchObject({
        utm_source: 'newsletter',
        initial_utm_source: 'facebookads',
        initial_utm_medium: 'paid_social',
        initial_utm_campaign: 'launch',
        channel: 'plus-modal',
      });
    });
  });
});
