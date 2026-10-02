import { describe, it, expect } from 'vitest';
import { resolveStripeCanceledAt } from '../../src/util/api/plus';

describe('resolveStripeCanceledAt', () => {
  it('prefers canceled_at when Stripe sets it', () => {
    expect(resolveStripeCanceledAt(
      { canceled_at: 1759000000, cancel_at: 1790000000 },
      { cancel_at: null },
      1759000100,
    )).toBe(1759000000);
  });

  it('stamps the event time when cancel_at is newly set without canceled_at', () => {
    // Billing-portal cancellations seen in production: cancel_at only,
    // cancellation_details.reason = cancellation_requested.
    expect(resolveStripeCanceledAt(
      { canceled_at: null, cancel_at: 1811404021 },
      { cancel_at: null },
      1759000100,
    )).toBe(1759000100);
  });

  it('keeps the recorded date on later updates that leave cancel_at alone', () => {
    expect(resolveStripeCanceledAt(
      { canceled_at: null, cancel_at: 1811404021 },
      { status: 'trialing' },
      1759500000,
    )).toBeUndefined();
  });

  it('clears the date when the cancellation is withdrawn', () => {
    expect(resolveStripeCanceledAt(
      { canceled_at: null, cancel_at: null },
      { cancel_at: 1811404021 },
      1759500000,
    )).toBeNull();
  });
});
