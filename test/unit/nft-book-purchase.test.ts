import {
  describe, it, expect,
} from 'vitest';
import { calculateStripeFee, normalizeLanguageForStripeLocale } from '../../src/util/stripe';
import { checkIsFromLikerLand, calculateItemPrices } from '../../src/util/api/likernft/book/price';

const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';
const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

const mockItem = {
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
};

describe('calculateStripeFee', () => {
  const testCases = [
    {
      amount: 0, currency: 'usd', expected: 0, description: 'zero amount',
    },
    {
      amount: 10000, currency: 'usd', expected: 470, description: '$100 USD (4.4% + $0.30)',
    },
    {
      amount: 10000, currency: 'hkd', expected: 570, description: '$100 HKD (with 1% FX fee)',
    },
    {
      amount: 10000, currency: 'twd', expected: 570, description: '$100 TWD (with 1% FX fee)',
    },
    {
      amount: 100, currency: 'usd', expected: 35, description: '$1 USD (small amount)',
    },
    {
      amount: 99, currency: 'usd', expected: 35, description: '$0.99 USD (minimum price)',
    },
    {
      amount: 100000, currency: 'usd', expected: 4430, description: '$1000 USD (large amount)',
    },
  ];

  testCases.forEach(({
    amount, currency, expected, description,
  }) => {
    it(`should calculate ${expected} cents for ${description}`, () => {
      expect(calculateStripeFee(amount, currency)).toBe(expected);
    });
  });
});

describe('normalizeLanguageForStripeLocale', () => {
  const testCases = [
    { input: 'zh', expected: 'zh-TW' },
    { input: 'zh-Hant', expected: 'zh-TW' },
    { input: 'zh-TW', expected: 'zh-TW' },
    { input: 'en', expected: 'en' },
    { input: 'zh-HK', expected: 'zh-HK' },
    { input: 'fr', expected: 'auto' },
    { input: undefined, expected: 'auto' },
  ];

  testCases.forEach(({ input, expected }) => {
    it(`should return "${expected}" for "${input}"`, () => {
      expect(normalizeLanguageForStripeLocale(input)).toBe(expected);
    });
  });
});

describe('checkIsFromLikerLand', () => {
  const testCases = [
    { input: 'liker_land', expected: true },
    { input: '@someuser', expected: false },
    { input: LIKER_LAND_WAIVED_CHANNEL, expected: false },
    { input: undefined as any, expected: false },
    { input: '', expected: false },
  ];

  testCases.forEach(({ input, expected }) => {
    it(`should return ${expected} for "${input}"`, () => {
      expect(checkIsFromLikerLand(input)).toBe(expected);
    });
  });
});

describe('calculateItemPrices', () => {
  describe('channel fee calculations', () => {
    const channelTestCases = [
      {
        name: 'liker_land channel',
        channel: NFT_BOOK_DEFAULT_FROM_CHANNEL,
        expected: {
          likerLandFeeAmount: 500,
          likerLandCommission: 3000,
          channelCommission: 0,
          likerLandArtFee: 0,
        },
      },
      {
        name: 'third-party channel',
        channel: '@bookstore_channel',
        expected: {
          likerLandFeeAmount: 500, likerLandCommission: 0, channelCommission: 3000,
        },
      },
      {
        name: 'waived channel',
        channel: LIKER_LAND_WAIVED_CHANNEL,
        expected: { likerLandFeeAmount: 500, likerLandCommission: 0, channelCommission: 0 },
      },
    ];

    channelTestCases.forEach(({ name, channel, expected }) => {
      it(`should calculate fees for ${name}`, () => {
        const [result] = calculateItemPrices([mockItem], channel);
        Object.entries(expected).forEach(([key, value]) => {
          expect(result[key]).toBe(value);
        });
      });
    });
  });

  describe('tipping', () => {
    const tipTestCases = [
      {
        name: 'tip on liker_land',
        item: { ...mockItem, priceInDecimal: 15000, customPriceDiffInDecimal: 5000 },
        channel: NFT_BOOK_DEFAULT_FROM_CHANNEL,
        expected: { likerLandTipFeeAmount: 500, likerLandCommission: 3000 },
      },
      {
        name: 'tip on external channel',
        item: { ...mockItem, priceInDecimal: 12000, customPriceDiffInDecimal: 2000 },
        channel: '@referrer',
        expected: { likerLandTipFeeAmount: 200, channelCommission: 3000, likerLandCommission: 0 },
      },
    ];

    tipTestCases.forEach(({
      name, item, channel, expected,
    }) => {
      it(`should calculate ${name}`, () => {
        const [result] = calculateItemPrices([item], channel);
        Object.entries(expected).forEach(([key, value]) => {
          expect(result[key]).toBe(value);
        });
      });
    });
  });

  describe('LikerLand Art fee', () => {
    const artFeeTestCases = [
      { isLikerLandArt: true, expectedArtFee: 1000 },
      { isLikerLandArt: false, expectedArtFee: 0 },
    ];

    artFeeTestCases.forEach(({ isLikerLandArt, expectedArtFee }) => {
      it(`should ${isLikerLandArt ? 'apply' : 'not apply'} art fee`, () => {
        const item = { ...mockItem, isLikerLandArt };
        const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result.likerLandArtFee).toBe(expectedArtFee);
      });
    });
  });

  describe('free items', () => {
    it('should waive all fees for free items', () => {
      const freeItem = {
        ...mockItem, priceInDecimal: 0, customPriceDiffInDecimal: 0, originalPriceInDecimal: 0,
      };
      const [result] = calculateItemPrices([freeItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.likerLandFeeAmount).toBe(0);
      expect(result.likerLandTipFeeAmount).toBe(0);
      expect(result.likerLandCommission).toBe(0);
      expect(result.channelCommission).toBe(0);
      expect(result.likerLandArtFee).toBe(0);
    });

    it('should charge tip fee on free book with tip', () => {
      const freeItemWithTip = {
        ...mockItem,
        priceInDecimal: 1000,
        customPriceDiffInDecimal: 1000,
        originalPriceInDecimal: 0,
      };
      const [result] = calculateItemPrices([freeItemWithTip], NFT_BOOK_DEFAULT_FROM_CHANNEL);
      expect(result.likerLandTipFeeAmount).toBe(100);
    });
  });

  describe('discounts', () => {
    const discountTestCases = [
      { name: '30% discount', priceInDecimal: 7000, expectedCommission: 0 },
      { name: '20% discount', priceInDecimal: 8000, expectedCommission: 1000 },
      { name: '50% discount', priceInDecimal: 5000, expectedCommission: 0 },
    ];

    discountTestCases.forEach(({ name, priceInDecimal, expectedCommission }) => {
      it(`should handle ${name}`, () => {
        const discountedItem = {
          ...mockItem, priceInDecimal, originalPriceInDecimal: 10000,
        };
        const [result] = calculateItemPrices([discountedItem], '@referrer');
        expect(result.channelCommission).toBe(expectedCommission);
      });
    });
  });

  describe('fee breakdown examples', () => {
    const breakdownTestCases = [
      {
        name: 'author direct ($100 book, ~90.3% royalty)',
        channel: LIKER_LAND_WAIVED_CHANNEL,
        expectedFees: { likerLandFeeAmount: 500, likerLandCommission: 0, channelCommission: 0 },
        totalFees: 970,
        royalty: 9030,
      },
      {
        name: 'third-party channel ($100 book, ~60.3% royalty)',
        channel: '@bookstore',
        expectedFees: { likerLandFeeAmount: 500, likerLandCommission: 0, channelCommission: 3000 },
        totalFees: 3970,
        royalty: 6030,
      },
    ];

    breakdownTestCases.forEach(({
      name, channel, expectedFees, totalFees, royalty,
    }) => {
      it(`should verify ${name}`, () => {
        const [result] = calculateItemPrices([mockItem], channel);
        const stripeFee = calculateStripeFee(10000, 'usd');

        Object.entries(expectedFees).forEach(([key, value]) => {
          expect(result[key]).toBe(value);
        });

        const calculatedTotalFees = result.likerLandFeeAmount
          + result.channelCommission + stripeFee;
        expect(calculatedTotalFees).toBe(totalFees);
        expect(10000 - calculatedTotalFees).toBe(royalty);
      });
    });
  });
});
