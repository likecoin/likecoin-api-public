import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const {
  mockRetrieve, mockPortalSessionCreate, mockUserDocUpdate, mockPublish, mockGetUserByWallet,
} = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  mockPortalSessionCreate: vi.fn(),
  mockUserDocUpdate: vi.fn(),
  mockPublish: vi.fn(),
  mockGetUserByWallet: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: { retrieve: mockRetrieve },
      billingPortal: { sessions: { create: mockPortalSessionCreate } },
    }),
  };
});

// Layer on the global in-memory stub (test/setup.ts), not importOriginal —
// the real src/util/firebase would initialize firebase-admin and crash.
vi.mock('../../src/util/firebase', async () => {
  const stub = await import('../stub/firebase');
  return {
    ...stub,
    userCollection: { doc: () => ({ update: mockUserDocUpdate }) },
  };
});

vi.mock('../../src/util/gcloudPub', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    default: { publish: mockPublish },
  };
});

vi.mock('../../src/util/api/users/getPublicInfo', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getUserWithCivicLikerPropertiesByWallet: mockGetUserByWallet,
  };
});

// Give the flow resolvable ids by mutating the real config singleton (rather
// than mocking config/config, whose object form turns it into a strict-ESM
// module and breaks the many consumers that read keys config.js leaves unset).
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_MONTHLY_PRICE_ID = 'price_plus_monthly';
cfg.LIKER_PLUS_YEARLY_PRICE_ID = 'price_plus_yearly';
cfg.LIKER_PLUS_CIVIC_MONTHLY_PRICE_ID = 'price_civic_monthly';
cfg.LIKER_PLUS_CIVIC_YEARLY_PRICE_ID = 'price_civic_yearly';
cfg.LIKER_PLUS_PRODUCT_ID = 'prod_plus';
cfg.LIKER_PLUS_CIVIC_PRODUCT_ID = 'prod_civic';
cfg.LIKER_PLUS_UPGRADE_PORTAL_CONFIG_ID = 'bpc_test_config';

// eslint-disable-next-line import/first
const {
  createPlusUpgradePortalSession,
  processStripeSubscriptionStatusUpdate,
} = await import('../../src/util/api/plus');

// eslint-disable-next-line import/first
const { PlusPortalBodySchema } = await import('../../src/util/api/plus/schemas');

const SUB_ID = 'sub_test';

describe('PlusPortalBodySchema', () => {
  it('accepts an absent or empty body as the homepage variant', () => {
    // A bodyless POST reaches Express 5 with req.body undefined, not {}.
    expect(PlusPortalBodySchema.safeParse(undefined).success).toBe(true);
    expect(PlusPortalBodySchema.safeParse({}).success).toBe(true);
  });

  it('rejects upgrade_confirm missing period/tier instead of falling through', () => {
    expect(PlusPortalBodySchema.safeParse({ flow: 'upgrade_confirm' }).success).toBe(false);
    expect(PlusPortalBodySchema.safeParse({ flow: 'upgrade_confirm', period: 'monthly' }).success).toBe(false);
  });

  it('accepts a fully specified upgrade_confirm body', () => {
    expect(PlusPortalBodySchema.safeParse({
      flow: 'upgrade_confirm', period: 'monthly', tier: 'civic',
    }).success).toBe(true);
  });
});

describe('createPlusUpgradePortalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pinned subscription_update_confirm portal session', async () => {
    mockRetrieve.mockResolvedValue({
      id: SUB_ID,
      status: 'active',
      items: { data: [{ id: 'si_test' }] },
    });
    mockPortalSessionCreate.mockResolvedValue({
      id: 'bps_test',
      url: 'https://billing.stripe.com/session/test',
    });
    const { session, paymentId } = await createPlusUpgradePortalSession({
      customerId: 'cus_test',
      subscriptionId: SUB_ID,
      tier: 'civic',
      period: 'monthly',
    });
    expect(session.id).toBe('bps_test');
    const [payload] = mockPortalSessionCreate.mock.calls[0];
    expect(payload.customer).toBe('cus_test');
    expect(payload.configuration).toBe('bpc_test_config');
    expect(payload.flow_data.type).toBe('subscription_update_confirm');
    expect(payload.flow_data.subscription_update_confirm).toEqual({
      subscription: SUB_ID,
      items: [{ id: 'si_test', price: 'price_civic_monthly', quantity: 1 }],
    });
    // via=portal, not redirect=1 — rationale in getPlusUpgradeSuccessPageURL.
    const returnURL = payload.flow_data.after_completion.redirect.return_url;
    expect(returnURL).toContain('via=portal');
    expect(returnURL).toContain('period=monthly');
    expect(returnURL).toContain('tier=civic');
    expect(returnURL).toContain(`payment_id=${paymentId}`);
  });

  it('rejects trialing subscriptions', async () => {
    mockRetrieve.mockResolvedValue({
      id: SUB_ID,
      status: 'trialing',
      items: { data: [{ id: 'si_test' }] },
    });
    await expect(createPlusUpgradePortalSession({
      customerId: 'cus_test',
      subscriptionId: SUB_ID,
      tier: 'civic',
      period: 'monthly',
    })).rejects.toThrow('Cannot upgrade a trial subscription.');
    expect(mockPortalSessionCreate).not.toHaveBeenCalled();
  });
});

describe('processStripeSubscriptionStatusUpdate plan mirror', () => {
  function makeSubscription({
    productId = 'prod_civic',
    interval = 'month',
    status = 'active',
  } = {}) {
    return {
      id: SUB_ID,
      status,
      metadata: { evmWallet: '0xabc' },
      items: { data: [{ id: 'si_test', price: { product: productId }, plan: { interval } }] },
    } as never;
  }

  function seedUser(likerPlus: Record<string, unknown>) {
    mockGetUserByWallet.mockResolvedValue({ user: 'testuser', likerPlus });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors a tier change applied outside /plus/price and logs it', async () => {
    seedUser({
      subscriptionId: SUB_ID, tier: 'plus', period: 'month', subscriptionStatus: 'active',
    });
    await processStripeSubscriptionStatusUpdate(makeSubscription());
    expect(mockUserDocUpdate).toHaveBeenCalledWith({
      'likerPlus.tier': 'civic',
      'likerPlus.period': 'month',
    });
    const [, , log] = mockPublish.mock.calls[0];
    expect(log).toMatchObject({
      logType: 'PlusSubscriptionPlanUpdated',
      subscriptionId: SUB_ID,
      tier: 'civic',
      previousTier: 'plus',
      period: 'monthly',
    });
  });

  it('is a no-op when status and plan are unchanged', async () => {
    seedUser({
      subscriptionId: SUB_ID, tier: 'civic', period: 'month', subscriptionStatus: 'active',
    });
    await processStripeSubscriptionStatusUpdate(makeSubscription());
    expect(mockUserDocUpdate).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not mirror plan from a subscription the record does not own', async () => {
    seedUser({
      subscriptionId: 'sub_other', tier: 'plus', period: 'month', subscriptionStatus: 'active',
    });
    await processStripeSubscriptionStatusUpdate(makeSubscription());
    expect(mockUserDocUpdate).not.toHaveBeenCalled();
  });

  it('still writes a bare status change without a plan change', async () => {
    seedUser({
      subscriptionId: SUB_ID, tier: 'civic', period: 'month', subscriptionStatus: 'active',
    });
    await processStripeSubscriptionStatusUpdate(makeSubscription({ status: 'past_due' }));
    expect(mockUserDocUpdate).toHaveBeenCalledWith({
      'likerPlus.subscriptionStatus': 'past_due',
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('treats a record with no tier as Plus (no spurious mirror)', async () => {
    seedUser({
      subscriptionId: SUB_ID, period: 'month', subscriptionStatus: 'active',
    });
    await processStripeSubscriptionStatusUpdate(makeSubscription({ productId: 'prod_plus' }));
    expect(mockUserDocUpdate).not.toHaveBeenCalled();
  });
});
