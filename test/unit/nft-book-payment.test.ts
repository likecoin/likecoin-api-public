import {
  describe, it, expect,
} from 'vitest';
import { buildBasePaymentPayload } from '../../src/util/api/likernft/book/payment';

const BASE_INPUT = {
  type: 'stripe',
  email: 'buyer@example.com',
  claimToken: 'test-claim-token',
  sessionId: 'cs_test_123',
  from: '@channel',
  priceInDecimal: 12345,
  originalPriceInDecimal: 20000,
};

describe('buildBasePaymentPayload', () => {
  it('should build the base fields shared by payment and cart docs', () => {
    const payload = buildBasePaymentPayload(BASE_INPUT);
    expect(payload).toMatchObject({
      type: 'stripe',
      email: 'buyer@example.com',
      isPaid: false,
      isPendingClaim: false,
      claimToken: 'test-claim-token',
      sessionId: 'cs_test_123',
      from: '@channel',
      status: 'new',
      price: 123.45,
      priceInDecimal: 12345,
      originalPriceInDecimal: 20000,
    });
    expect(payload.timestamp).toBeDefined();
    expect(Object.keys(payload).sort()).toEqual([
      'claimToken',
      'email',
      'from',
      'isPaid',
      'isPendingClaim',
      'originalPriceInDecimal',
      'price',
      'priceInDecimal',
      'sessionId',
      'status',
      'timestamp',
      'type',
    ]);
  });

  it('should default optional string fields to empty strings', () => {
    const payload = buildBasePaymentPayload({
      type: 'free',
      claimToken: 'token',
      priceInDecimal: 0,
      originalPriceInDecimal: 0,
    });
    expect(payload.email).toBe('');
    expect(payload.sessionId).toBe('');
    expect(payload.from).toBe('');
    expect(payload.price).toBe(0);
  });

  it('should only include coupon and ipCountry when set', () => {
    const bare = buildBasePaymentPayload(BASE_INPUT);
    expect(bare).not.toHaveProperty('coupon');
    expect(bare).not.toHaveProperty('ipCountry');

    const withExtras = buildBasePaymentPayload({
      ...BASE_INPUT,
      coupon: 'PROMO10',
      ipCountry: 'HK',
    });
    expect(withExtras.coupon).toBe('PROMO10');
    expect(withExtras.ipCountry).toBe('HK');
  });

  it('should not mark gift when giftInfo is absent', () => {
    const payload = buildBasePaymentPayload(BASE_INPUT);
    expect(payload).not.toHaveProperty('isGift');
    expect(payload).not.toHaveProperty('giftInfo');
  });

  it('should normalize the gift block with defaulted message', () => {
    const payload = buildBasePaymentPayload({
      ...BASE_INPUT,
      giftInfo: {
        toEmail: 'to@example.com',
        toName: 'To',
        fromName: 'From',
      },
    });
    expect(payload.isGift).toBe(true);
    expect(payload.giftInfo).toEqual({
      toEmail: 'to@example.com',
      toName: 'To',
      fromName: 'From',
      message: '',
    });
  });
});
