import { describe, it, expect } from 'vitest';
import { getRevenueCatPaymentAmount } from '../../src/util/api/plus/revenuecat';

describe('getRevenueCatPaymentAmount', () => {
  it('pairs the local amount with the local currency when present', () => {
    // RevenueCat sends the local charge in price_in_purchased_currency + currency.
    expect(getRevenueCatPaymentAmount({
      type: 'RENEWAL',
      price: 4.78, // USD-normalized
      price_in_purchased_currency: 700,
      currency: 'JPY',
    })).toEqual({ amount: 700, currency: 'JPY' });
  });

  it('never labels the USD price with the local currency (the reported bug)', () => {
    // Local amount absent: must fall back to USD, not pair the USD price with JPY.
    expect(getRevenueCatPaymentAmount({
      type: 'RENEWAL',
      price: 4.78,
      currency: 'JPY',
    })).toEqual({ amount: 4.78, currency: 'USD' });
  });

  it('treats a USD purchase consistently', () => {
    expect(getRevenueCatPaymentAmount({
      type: 'INITIAL_PURCHASE',
      price: 9.99,
      price_in_purchased_currency: 9.99,
      currency: 'USD',
    })).toEqual({ amount: 9.99, currency: 'USD' });
  });

  it('returns an empty pair when there is no price (e.g. trial grant)', () => {
    expect(getRevenueCatPaymentAmount({ type: 'INITIAL_PURCHASE' })).toEqual({});
  });
});
