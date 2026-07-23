import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockRetrieve, mockUpdate } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: { retrieve: mockRetrieve, update: mockUpdate },
    }),
  };
});

// Give Civic resolvable price ids by mutating the real config singleton (rather
// than mocking config/config, whose object form turns it into a strict-ESM
// module and breaks the many consumers that read keys config.js leaves unset).
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_CIVIC_MONTHLY_PRICE_ID = 'price_civic_monthly';
cfg.LIKER_PLUS_CIVIC_YEARLY_PRICE_ID = 'price_civic_yearly';
cfg.LIKER_PLUS_MONTHLY_PRICE_ID = 'price_plus_monthly';
cfg.LIKER_PLUS_YEARLY_PRICE_ID = 'price_plus_yearly';

// eslint-disable-next-line import/first
const { updateSubscriptionPeriod } = await import('../../src/util/api/plus');

const SUB_ID = 'sub_test';

function seedSubscription(status: string, tier?: string) {
  mockRetrieve.mockResolvedValue({
    id: SUB_ID,
    status,
    metadata: tier ? { tier } : {},
    items: { data: [{ id: 'si_test' }] },
  });
}

describe('updateSubscriptionPeriod tier-upgrade proration', () => {
  beforeEach(() => {
    mockRetrieve.mockReset();
    mockUpdate.mockReset();
  });

  it('forces an immediate invoice on a Plus -> Civic upgrade', async () => {
    seedSubscription('active', 'plus');
    await updateSubscriptionPeriod(SUB_ID, 'monthly', { tier: 'civic' });
    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload.proration_behavior).toBe('always_invoice');
  });

  it('treats a subscription with no tier metadata as Plus (upgrade to Civic)', async () => {
    seedSubscription('active');
    await updateSubscriptionPeriod(SUB_ID, 'yearly', { tier: 'civic' });
    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload.proration_behavior).toBe('always_invoice');
  });

  it('leaves proration default on a same-tier period change', async () => {
    seedSubscription('active', 'civic');
    await updateSubscriptionPeriod(SUB_ID, 'yearly', { tier: 'civic' });
    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload.proration_behavior).toBeUndefined();
  });

  it('leaves proration default on a Civic -> Plus downgrade (credits at renewal)', async () => {
    seedSubscription('active', 'civic');
    await updateSubscriptionPeriod(SUB_ID, 'monthly', { tier: 'plus' });
    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload.proration_behavior).toBeUndefined();
  });

  it('keeps the trial reset (proration none) even when the tier rises', async () => {
    seedSubscription('trialing', 'plus');
    await updateSubscriptionPeriod(SUB_ID, 'monthly', { tier: 'civic' });
    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload.proration_behavior).toBe('none');
    expect(payload.trial_end).toBe('now');
  });
});
