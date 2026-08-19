import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { checkIsStripeConnectAccountReady } from '../../src/util/stripe';

// Only the fields the predicate reads; a real Stripe.Account is far larger.
function account(fields: Partial<Stripe.Account>): Stripe.Account {
  return fields as Stripe.Account;
}

describe('checkIsStripeConnectAccountReady', () => {
  it('accepts an account whose transfers capability is active', () => {
    expect(checkIsStripeConnectAccountReady(account({
      charges_enabled: true,
      capabilities: { transfers: 'active' },
    }))).toBe(true);
  });

  it('accepts a crypto payout account, whose capability is named crypto_transfers', () => {
    expect(checkIsStripeConnectAccountReady(account({
      charges_enabled: true,
      capabilities: { crypto_transfers: 'active' } as unknown as Stripe.Account.Capabilities,
    }))).toBe(true);
  });

  // The regression: charges_enabled flips true while transfers is still under review.
  it('rejects an account that can take charges but has transfers still pending', () => {
    expect(checkIsStripeConnectAccountReady(account({
      charges_enabled: true,
      details_submitted: true,
      capabilities: { transfers: 'pending' },
    }))).toBe(false);
  });

  it('accepts an account left on the legacy_payments capability', () => {
    expect(checkIsStripeConnectAccountReady(account({
      capabilities: { legacy_payments: 'active' },
    }))).toBe(true);
  });

  it('rejects an account with no capabilities at all', () => {
    expect(checkIsStripeConnectAccountReady(account({ charges_enabled: true }))).toBe(false);
  });
});
