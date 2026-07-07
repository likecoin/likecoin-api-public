import {
  describe, it, expect,
} from 'vitest';
import {
  assertClaimable,
  buildBasePaymentPayload,
  calculateItemFeeInfo,
  sumFeeInfo,
} from '../../src/util/api/likernft/book/payment';
import type { ItemPriceInfo } from '../../src/util/api/likernft/book/type';
import { ValidationError } from '../../src/util/ValidationError';

const createMockItemPrice = (overrides: Partial<ItemPriceInfo> = {}): ItemPriceInfo => ({
  quantity: 1,
  currency: 'usd',
  priceInDecimal: 10000,
  customPriceDiffInDecimal: 0,
  originalPriceInDecimal: 10000,
  likerLandTipFeeAmount: 0,
  likerLandFeeAmount: 500,
  likerLandCommission: 3000,
  channelCommission: 0,
  likerLandArtFee: 0,
  classId: 'test-class-id',
  priceIndex: 0,
  ...overrides,
});

describe('assertClaimable', () => {
  const TOKEN = 'valid-token';
  const WALLET = '0x1234567890abcdef1234567890abcdef12345678';
  const OTHER_WALLET = '0xffffffffffffffffffffffffffffffffffffffff';

  const expectClaimError = (
    run: () => void,
    message: string,
    status: number,
  ) => {
    let error: ValidationError | undefined;
    try {
      run();
    } catch (err) {
      error = err as ValidationError;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.message).toBe(message);
    expect(error?.status).toBe(status);
  };

  (['PAYMENT', 'CART'] as const).forEach((prefix) => {
    describe(`with ${prefix} prefix`, () => {
      it('should pass for a paid unclaimed doc with a valid token', () => {
        expect(() => assertClaimable(
          { claimToken: TOKEN, status: 'paid' },
          { token: TOKEN, wallet: WALLET },
          prefix,
        )).not.toThrow();
      });

      it('should pass when re-claimed by the same wallet while still paid', () => {
        expect(() => assertClaimable(
          { claimToken: TOKEN, status: 'paid', wallet: WALLET },
          { token: TOKEN, wallet: WALLET },
          prefix,
        )).not.toThrow();
      });

      it('should reject an invalid token before leaking any claim state', () => {
        const claimedStates = [
          { claimToken: TOKEN, status: 'paid' },
          { claimToken: TOKEN, status: 'paid', wallet: OTHER_WALLET },
          { claimToken: TOKEN, status: 'pending', wallet: OTHER_WALLET },
          { claimToken: TOKEN, status: 'completed', wallet: WALLET },
        ];
        claimedStates.forEach((docData) => {
          expectClaimError(
            () => assertClaimable(docData, { token: 'bad-token', wallet: WALLET }, prefix),
            'INVALID_CLAIM_TOKEN',
            403,
          );
        });
      });

      it('should reject when claimed by another wallet regardless of status', () => {
        ['paid', 'pending', 'completed'].forEach((status) => {
          expectClaimError(
            () => assertClaimable(
              { claimToken: TOKEN, status, wallet: OTHER_WALLET },
              { token: TOKEN, wallet: WALLET },
              prefix,
            ),
            `${prefix}_ALREADY_CLAIMED_BY_OTHER`,
            403,
          );
        });
      });

      it('should report already claimed by wallet when the same wallet re-claims', () => {
        expectClaimError(
          () => assertClaimable(
            { claimToken: TOKEN, status: 'pending', wallet: WALLET },
            { token: TOKEN, wallet: WALLET },
            prefix,
          ),
          `${prefix}_ALREADY_CLAIMED_BY_WALLET`,
          409,
        );
      });

      it('should report already claimed when not paid and no wallet recorded', () => {
        ['new', 'pending', 'completed', 'error'].forEach((status) => {
          expectClaimError(
            () => assertClaimable(
              { claimToken: TOKEN, status },
              { token: TOKEN, wallet: WALLET },
              prefix,
            ),
            `${prefix}_ALREADY_CLAIMED`,
            403,
          );
        });
      });
    });
  });
});

describe('calculateItemFeeInfo', () => {
  it('should prorate stripe fee by line share and subtract it once from royaltyToSplit', () => {
    const item = createMockItemPrice({ quantity: 2 });
    const result = calculateItemFeeInfo(item, {
      totalStripeFeeAmount: 900,
      totalPriceInDecimal: 30000,
    });

    // line total is 20000 of a 30000 cart, so 2/3 of the 900 fee
    expect(result.stripeFeeAmount).toBe(600);
    expect(result.priceInDecimal).toBe(20000);
    expect(result.originalPriceInDecimal).toBe(20000);
    expect(result.likerLandFeeAmount).toBe(1000);
    expect(result.likerLandCommission).toBe(6000);
    expect(result.royaltyToSplit).toBe((10000 - 500 - 3000) * 2 - 600);
  });

  it('should return zero stripe fee and royalty for zero-price items', () => {
    const item = createMockItemPrice({
      priceInDecimal: 0,
      originalPriceInDecimal: 0,
      likerLandFeeAmount: 0,
      likerLandCommission: 0,
    });
    const result = calculateItemFeeInfo(item, {
      totalStripeFeeAmount: 0,
      totalPriceInDecimal: 0,
    });

    expect(result.stripeFeeAmount).toBe(0);
    expect(result.priceInDecimal).toBe(0);
    expect(result.royaltyToSplit).toBe(0);

    // guard against Infinity when a fee exists but the total price is zero
    const zeroTotal = calculateItemFeeInfo(item, {
      totalStripeFeeAmount: 100,
      totalPriceInDecimal: 0,
    });
    expect(zeroTotal.stripeFeeAmount).toBe(0);
  });

  it('should clamp royaltyToSplit at zero when fees exceed the price', () => {
    const item = createMockItemPrice({
      priceInDecimal: 1000,
      likerLandFeeAmount: 500,
      likerLandCommission: 600,
    });
    const result = calculateItemFeeInfo(item, {
      totalStripeFeeAmount: 100,
      totalPriceInDecimal: 1000,
    });

    expect(result.royaltyToSplit).toBe(0);
  });

  it('should bound the summed ceil-prorated stripe fees within one cent per item', () => {
    const totalStripeFeeAmount = 101;
    const items = [
      createMockItemPrice({ priceInDecimal: 3333 }),
      createMockItemPrice({ priceInDecimal: 3333 }),
      createMockItemPrice({ priceInDecimal: 3334 }),
    ];
    const totalPriceInDecimal = items
      .reduce((acc, item) => acc + item.priceInDecimal * item.quantity, 0);
    const summed = items
      .map((item) => calculateItemFeeInfo(item, { totalStripeFeeAmount, totalPriceInDecimal }))
      .reduce((acc, feeInfo) => acc + feeInfo.stripeFeeAmount, 0);

    expect(summed).toBeGreaterThanOrEqual(totalStripeFeeAmount);
    expect(summed).toBeLessThan(totalStripeFeeAmount + items.length);
  });
});

describe('sumFeeInfo', () => {
  it('should sum every field so totals equal the sum of items', () => {
    const items = [
      createMockItemPrice({ priceInDecimal: 10000, quantity: 1 }),
      createMockItemPrice({
        priceInDecimal: 23000,
        originalPriceInDecimal: 20000,
        customPriceDiffInDecimal: 3000,
        likerLandTipFeeAmount: 300,
        likerLandFeeAmount: 1000,
        likerLandCommission: 0,
        channelCommission: 6000,
        likerLandArtFee: 2000,
        quantity: 2,
      }),
    ];
    const totalPriceInDecimal = items
      .reduce((acc, item) => acc + item.priceInDecimal * item.quantity, 0);
    const itemFeeInfos = items.map((item) => calculateItemFeeInfo(item, {
      totalStripeFeeAmount: 1900,
      totalPriceInDecimal,
    }));
    const total = sumFeeInfo(itemFeeInfos);

    (Object.keys(total) as (keyof typeof total)[]).forEach((key) => {
      expect(total[key]).toBe(itemFeeInfos.reduce((acc, feeInfo) => acc + feeInfo[key], 0));
    });
    expect(total.priceInDecimal).toBe(totalPriceInDecimal);
  });

  it('should return all zeros for an empty list', () => {
    const total = sumFeeInfo([]);
    expect(Object.values(total).every((value) => value === 0)).toBe(true);
  });
});

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
