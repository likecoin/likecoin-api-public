import { describe, it, expect } from 'vitest';
import { buildSubscriptionStatusFields } from '../../src/util/airtable';

describe('buildSubscriptionStatusFields', () => {
  it('converts a Stripe timestamp to an ISO Canceled Date', () => {
    expect(buildSubscriptionStatusFields({
      providerStatus: 'canceled',
      canceledAt: 1757071522, // 2025-09-05T11:25:22Z
    })).toEqual({
      'Provider Status': 'canceled',
      'Canceled Date': '2025-09-05T11:25:22.000Z',
    });
  });

  it('clears Canceled Date on null (the reported bug)', () => {
    // Stripe nulls canceled_at when a cancel_at_period_end subscription is
    // reinstated; leaving the old date behind would keep it reading as churned.
    expect(buildSubscriptionStatusFields({
      providerStatus: 'active',
      canceledAt: null,
    })).toEqual({
      'Provider Status': 'active',
      'Canceled Date': null,
    });
  });

  it('leaves Canceled Date untouched when the caller omits it', () => {
    // Distinct from null: callers with nothing to say about the date must not
    // wipe one that another webhook already recorded.
    expect(buildSubscriptionStatusFields({
      providerStatus: 'past_due',
    })).toEqual({ 'Provider Status': 'past_due' });
  });

  it('treats epoch 0 as a real timestamp rather than absent', () => {
    expect(buildSubscriptionStatusFields({
      providerStatus: 'canceled',
      canceledAt: 0,
    })).toEqual({
      'Provider Status': 'canceled',
      'Canceled Date': '1970-01-01T00:00:00.000Z',
    });
  });
});
