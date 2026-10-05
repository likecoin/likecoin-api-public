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
  processStripeSubscriptionCancellation,
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
