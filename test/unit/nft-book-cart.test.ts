import {
  describe, it, expect,
} from 'vitest';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import { calculateStripeFee } from '../../src/util/stripe';
import { calculateItemPrices } from '../../src/util/api/likernft/book/price';

const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';
const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

const createMockItem = (overrides: Partial<CartItemWithInfo> = {}): CartItemWithInfo => ({
  classId: 'test-class-id',
  priceIndex: 0,
  quantity: 1,
  priceInDecimal: 10000,
  customPriceDiffInDecimal: 0,
  stock: 100,
  isAllowCustomPrice: false,
  name: 'Test Book',
  description: 'Test Description',
  images: ['https://example.com/image.jpg'],
  ownerWallet: '0x1234567890abcdef1234567890abcdef12345678',
  isLikerLandArt: false,
  originalPriceInDecimal: 10000,
  iscnPrefix: 'iscn://test',
  priceName: 'Standard',
  stripePriceId: 'price_test123',
  chain: 'evm' as const,
  ...overrides,
});

describe('calculateItemPrices', () => {
  const channelFeeTestCases = [
    {
      name: 'liker_land channel',
      channel: NFT_BOOK_DEFAULT_FROM_CHANNEL,
      expected: {
        likerLandFeeAmount: 500,
        likerLandCommission: 3000,
        channelCommission: 0,
        royaltyToSplit: 6030,
      },
    },
    {
      name: 'waived channel (author direct)',
      channel: LIKER_LAND_WAIVED_CHANNEL,
      expected: {
        likerLandFeeAmount: 500,
        likerLandCommission: 0,
        channelCommission: 0,
        royaltyToSplit: 9030,
      },
    },
    {
      name: 'third-party channel',
      channel: '@bookstore_channel',
      expected: {
        likerLandFeeAmount: 500,
        likerLandCommission: 0,
        channelCommission: 3000,
        royaltyToSplit: 6030,
      },
    },
  ];

  channelFeeTestCases.forEach(({ name, channel, expected }) => {
    it(`should calculate fees for ${name}`, () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], channel);
      const stripeFeeAmount = calculateStripeFee(10000);

      expect(result.likerLandFeeAmount).toBe(expected.likerLandFeeAmount);
      expect(result.likerLandCommission).toBe(expected.likerLandCommission);
      expect(result.channelCommission).toBe(expected.channelCommission);

      const royaltyToSplit = result.priceInDecimal
        - stripeFeeAmount
        - result.likerLandFeeAmount
        - result.likerLandTipFeeAmount
        - result.likerLandCommission
        - result.channelCommission
        - result.likerLandArtFee;
      expect(royaltyToSplit).toBe(expected.royaltyToSplit);
    });
  });

  it('should calculate all fees for LikerLand Art with tip', () => {
    const item = createMockItem({
      priceInDecimal: 23000,
      originalPriceInDecimal: 20000,
      customPriceDiffInDecimal: 3000,
      isLikerLandArt: true,
    });
    const [result] = calculateItemPrices([item], '@external_channel');

    expect(result.likerLandFeeAmount).toBe(1000);
    expect(result.likerLandTipFeeAmount).toBe(300);
    expect(result.channelCommission).toBe(6000);
    expect(result.likerLandArtFee).toBe(2000);
  });

  it('should return zero fees for free items', () => {
    const item = createMockItem({
      priceInDecimal: 0,
      originalPriceInDecimal: 0,
      customPriceDiffInDecimal: 0,
    });
    const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

    expect(result.likerLandFeeAmount).toBe(0);
    expect(result.likerLandTipFeeAmount).toBe(0);
    expect(result.likerLandCommission).toBe(0);
    expect(result.channelCommission).toBe(0);
    expect(result.likerLandArtFee).toBe(0);
  });

  it('should handle multiple items', () => {
    const items = [
      createMockItem({
        classId: 'class-1', priceInDecimal: 10000, originalPriceInDecimal: 10000, quantity: 1,
      }),
      createMockItem({
        classId: 'class-2', priceInDecimal: 20000, originalPriceInDecimal: 20000, quantity: 2,
      }),
    ];

    const results = calculateItemPrices(items, NFT_BOOK_DEFAULT_FROM_CHANNEL);

    expect(results).toHaveLength(2);
    expect(results[0].likerLandFeeAmount).toBe(500);
    expect(results[0].likerLandCommission).toBe(3000);
    expect(results[1].likerLandFeeAmount).toBe(1000);
    expect(results[1].likerLandCommission).toBe(6000);
  });

  describe('channel commission with discounts', () => {
    const discountTestCases = [
      { name: '30% discount', priceInDecimal: 7000, expectedCommission: 0 },
      { name: 'no discount', priceInDecimal: 10000, expectedCommission: 3000 },
      { name: '20% discount', priceInDecimal: 8000, expectedCommission: 1000 },
      { name: '50% discount (large)', priceInDecimal: 5000, expectedCommission: 0 },
    ];

    discountTestCases.forEach(({ name, priceInDecimal, expectedCommission }) => {
      it(`should calculate commission with ${name}`, () => {
        const item = createMockItem({ priceInDecimal, originalPriceInDecimal: 10000 });
        const [result] = calculateItemPrices([item], '@external_channel');
        expect(result.channelCommission).toBe(expectedCommission);
      });
    });
  });

  describe('commission assignment by channel', () => {
    const commissionTestCases = [
      {
        name: 'liker_land channel',
        channel: NFT_BOOK_DEFAULT_FROM_CHANNEL,
        expectedLikerLand: 3000,
        expectedChannel: 0,
      },
      {
        name: 'external referrer',
        channel: '@bookstore_channel',
        expectedLikerLand: 0,
        expectedChannel: 3000,
      },
      {
        name: 'waived channel',
        channel: LIKER_LAND_WAIVED_CHANNEL,
        expectedLikerLand: 0,
        expectedChannel: 0,
      },
    ];

    commissionTestCases.forEach(({
      name, channel, expectedLikerLand, expectedChannel,
    }) => {
      it(`should assign commission correctly for ${name}`, () => {
        const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
        const [result] = calculateItemPrices([item], channel);
        expect(result.likerLandCommission).toBe(expectedLikerLand);
        expect(result.channelCommission).toBe(expectedChannel);
      });
    });
  });
});

describe('calculateStripeFee', () => {
  const stripeFeeTestCases = [
    { amount: 0, currency: 'usd', expected: 0 },
    { amount: 10000, currency: 'usd', expected: 470 },
    { amount: 10000, currency: 'hkd', expected: 570 },
    { amount: 100, currency: 'usd', expected: 35 },
    { amount: 100000, currency: 'usd', expected: 4430 },
  ];

  stripeFeeTestCases.forEach(({ amount, currency, expected }) => {
    it(`should return ${expected} for ${amount} ${currency.toUpperCase()}`, () => {
      expect(calculateStripeFee(amount, currency)).toBe(expected);
    });
  });
});
