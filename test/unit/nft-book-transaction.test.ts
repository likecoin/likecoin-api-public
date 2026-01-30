import {
  describe, it, expect,
} from 'vitest';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import { ValidationError } from '../../src/util/ValidationError';
import { calculateStripeFee } from '../../src/util/stripe';
import { calculateItemPrices } from '../../src/util/api/likernft/book/price';
import { NFT_BOOK_DEFAULT_FROM_CHANNEL, LIKER_LAND_WAIVED_CHANNEL } from '../../src/constant';

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

describe('calculateItemPrices - tipping', () => {
  const tippingTestCases = [
    {
      name: 'with tip',
      item: {
        priceInDecimal: 15000, originalPriceInDecimal: 10000, customPriceDiffInDecimal: 5000,
      },
      expectedTipFee: 500,
      expectedCustomPriceDiff: 5000,
    },
    {
      name: 'without tip',
      item: {
        priceInDecimal: 10000, originalPriceInDecimal: 10000, customPriceDiffInDecimal: 0,
      },
      expectedTipFee: 0,
      expectedCustomPriceDiff: 0,
    },
  ];

  tippingTestCases.forEach(({
    name, item, expectedTipFee, expectedCustomPriceDiff,
  }) => {
    it(`should calculate tip fee ${name}`, () => {
      const mockItem = createMockItem(item);
      const [result] = calculateItemPrices([mockItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.likerLandTipFeeAmount).toBe(expectedTipFee);
      expect(result.customPriceDiffInDecimal).toBe(expectedCustomPriceDiff);
    });
  });
});

describe('calculateItemPrices - channel fees', () => {
  const channelFeeTestCases = [
    {
      name: 'liker_land channel',
      channel: NFT_BOOK_DEFAULT_FROM_CHANNEL,
      expected: { likerLandCommission: 3000, channelCommission: 0, likerLandFeeAmount: 500 },
    },
    {
      name: 'external channel with tip',
      channel: '@external_channel',
      item: {
        priceInDecimal: 15000, customPriceDiffInDecimal: 5000, originalPriceInDecimal: 10000,
      },
      expected: {
        likerLandCommission: 0,
        channelCommission: 3000,
        likerLandTipFeeAmount: 500,
        likerLandFeeAmount: 500,
      },
    },
  ];

  channelFeeTestCases.forEach(({
    name, channel, item, expected,
  }) => {
    it(`should calculate fees for ${name}`, () => {
      const mockItem = createMockItem(item || {});
      const [result] = calculateItemPrices([mockItem], channel);

      Object.entries(expected).forEach(([key, value]) => {
        expect(result[key]).toBe(value);
      });
    });
  });
});

describe('calculateItemPrices - fee breakdown', () => {
  it('should calculate all fee components correctly', () => {
    const item = createMockItem({
      priceInDecimal: 60000,
      originalPriceInDecimal: 50000,
      customPriceDiffInDecimal: 10000,
    });
    const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);
    const stripeFeeAmount = calculateStripeFee(60000);

    expect(result.priceInDecimal).toBe(60000);
    expect(result.originalPriceInDecimal).toBe(50000);
    expect(result.customPriceDiffInDecimal).toBe(10000);
    expect(result.likerLandTipFeeAmount).toBe(1000);
    expect(result.likerLandFeeAmount).toBe(2500);
    expect(result.likerLandCommission).toBe(15000);
    expect(result.channelCommission).toBe(0);
    expect(result.likerLandArtFee).toBe(0);

    const royaltyToSplit = result.priceInDecimal - stripeFeeAmount - result.likerLandFeeAmount
      - result.likerLandTipFeeAmount - result.likerLandCommission
      - result.channelCommission - result.likerLandArtFee;
    expect(royaltyToSplit).toBe(38830);
  });
});

describe('ValidationError', () => {
  const errorTestCases = [
    { message: 'CLASS_ID_NOT_FOUND', status: undefined, expectedStatus: 400 },
    { message: 'PAYMENT_ID_NOT_FOUND', status: 404, expectedStatus: 404 },
  ];

  errorTestCases.forEach(({ message, status, expectedStatus }) => {
    it(`should create error with status ${expectedStatus}`, () => {
      const error = status ? new ValidationError(message, status) : new ValidationError(message);
      expect(error.message).toBe(message);
      expect(error.name).toBe('ValidationError');
      expect(error.status).toBe(expectedStatus);
    });
  });
});

describe('Fee breakdown examples', () => {
  const feeBreakdownTestCases = [
    {
      name: 'author direct sale ($100 book, ~90.3% royalty)',
      channel: LIKER_LAND_WAIVED_CHANNEL,
      expected: {
        likerLandFeeAmount: 500,
        likerLandCommission: 0,
        channelCommission: 0,
        totalFees: 970,
        royalty: 9030,
      },
    },
    {
      name: 'third-party channel ($100 book, ~60.3% royalty)',
      channel: '@bookstore',
      expected: {
        likerLandFeeAmount: 500,
        likerLandCommission: 0,
        channelCommission: 3000,
        totalFees: 3970,
        royalty: 6030,
      },
    },
  ];

  feeBreakdownTestCases.forEach(({ name, channel, expected }) => {
    it(`should match ${name}`, () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], channel);
      const stripeFee = calculateStripeFee(10000);

      expect(result.likerLandFeeAmount).toBe(expected.likerLandFeeAmount);
      expect(result.likerLandCommission).toBe(expected.likerLandCommission);
      expect(result.channelCommission).toBe(expected.channelCommission);

      const totalFees = result.likerLandFeeAmount + result.channelCommission + stripeFee;
      const royalty = 10000 - totalFees;

      expect(totalFees).toBe(expected.totalFees);
      expect(royalty).toBe(expected.royalty);
    });
  });

  it('should route commission to correct recipient based on channel', () => {
    const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });

    const commissionTestCases = [
      { channel: NFT_BOOK_DEFAULT_FROM_CHANNEL, likerLand: 3000, external: 0 },
      { channel: '@bookstore', likerLand: 0, external: 3000 },
      { channel: LIKER_LAND_WAIVED_CHANNEL, likerLand: 0, external: 0 },
    ];

    commissionTestCases.forEach(({ channel, likerLand, external }) => {
      const [result] = calculateItemPrices([item], channel);
      expect(result.likerLandCommission).toBe(likerLand);
      expect(result.channelCommission).toBe(external);
    });
  });
});
