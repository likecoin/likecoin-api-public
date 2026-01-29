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

describe('NFT Book Cart - Fee Calculation and Royalty Split', () => {
  describe('calculateItemPrices', () => {
    it('should calculate fees for liker_land channel sale', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);
      const stripeFeeAmount = calculateStripeFee(10000);

      expect(result.likerLandFeeAmount).toBe(500);
      expect(result.likerLandCommission).toBe(3000);
      expect(result.channelCommission).toBe(0);

      const royaltyToSplit = result.priceInDecimal - stripeFeeAmount - result.likerLandFeeAmount
        - result.likerLandTipFeeAmount - result.likerLandCommission
        - result.channelCommission - result.likerLandArtFee;
      expect(royaltyToSplit).toBe(6030);
    });

    it('should calculate fees for waived channel (author direct)', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], LIKER_LAND_WAIVED_CHANNEL);
      const stripeFeeAmount = calculateStripeFee(10000);

      expect(result.likerLandFeeAmount).toBe(500);
      expect(result.likerLandCommission).toBe(0);
      expect(result.channelCommission).toBe(0);

      const royaltyToSplit = result.priceInDecimal - stripeFeeAmount - result.likerLandFeeAmount
        - result.likerLandTipFeeAmount - result.likerLandCommission
        - result.channelCommission - result.likerLandArtFee;
      expect(royaltyToSplit).toBe(9030);
    });

    it('should calculate fees for third-party channel sale', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], '@bookstore_channel');
      const stripeFeeAmount = calculateStripeFee(10000);

      expect(result.likerLandFeeAmount).toBe(500);
      expect(result.likerLandCommission).toBe(0);
      expect(result.channelCommission).toBe(3000);

      const royaltyToSplit = result.priceInDecimal - stripeFeeAmount - result.likerLandFeeAmount
        - result.likerLandTipFeeAmount - result.likerLandCommission
        - result.channelCommission - result.likerLandArtFee;
      expect(royaltyToSplit).toBe(6030);
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

    it('should return all required price info fields', () => {
      const item = createMockItem({
        quantity: 2,
        priceInDecimal: 25000,
        customPriceDiffInDecimal: 5000,
        originalPriceInDecimal: 20000,
      });
      const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.quantity).toBe(2);
      expect(result.currency).toBe('usd');
      expect(result.priceInDecimal).toBe(25000);
      expect(result.originalPriceInDecimal).toBe(20000);
      expect(result.customPriceDiffInDecimal).toBe(5000);
      expect(result.likerLandTipFeeAmount).toBe(500);
      expect(result.likerLandFeeAmount).toBe(1000);
      expect(result.likerLandCommission).toBe(6000);
      expect(result.classId).toBe('test-class-id');
      expect(result.priceIndex).toBe(0);
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
  });

  describe('Channel Commission with Discounts', () => {
    it('should reduce channel commission by discount amount (30% discount = 0 commission)', () => {
      const item = createMockItem({
        priceInDecimal: 7000,
        originalPriceInDecimal: 10000,
      });
      const [result] = calculateItemPrices([item], '@external_channel');

      expect(result.channelCommission).toBe(0);
    });

    it('should calculate full commission without discount', () => {
      const item = createMockItem({
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
      });
      const [result] = calculateItemPrices([item], '@external_channel');

      expect(result.channelCommission).toBe(3000);
    });

    it('should partially reduce commission for smaller discounts', () => {
      const item = createMockItem({
        priceInDecimal: 8000,
        originalPriceInDecimal: 10000,
      });
      const [result] = calculateItemPrices([item], '@external_channel');

      expect(result.channelCommission).toBe(1000);
    });

    it('should ensure commission is never negative with large discount', () => {
      const item = createMockItem({
        priceInDecimal: 5000,
        originalPriceInDecimal: 10000,
      });
      const [result] = calculateItemPrices([item], '@external_channel');

      expect(result.channelCommission).toBe(0);
    });
  });

  describe('Commission Assignment by Channel', () => {
    it('should assign commission to likerLand for liker_land channel', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.likerLandCommission).toBe(3000);
      expect(result.channelCommission).toBe(0);
    });

    it('should assign commission to channel for external referrer', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], '@bookstore_channel');

      expect(result.likerLandCommission).toBe(0);
      expect(result.channelCommission).toBe(3000);
    });

    it('should waive all commission for liker_land_waived channel', () => {
      const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
      const [result] = calculateItemPrices([item], LIKER_LAND_WAIVED_CHANNEL);

      expect(result.likerLandCommission).toBe(0);
      expect(result.channelCommission).toBe(0);
    });
  });
});

describe('calculateStripeFee', () => {
  it('should return 0 for zero amount', () => {
    expect(calculateStripeFee(0)).toBe(0);
  });

  it('should calculate fee for USD (4.4% + $0.30)', () => {
    expect(calculateStripeFee(10000, 'usd')).toBe(470);
  });

  it('should add 1% FX fee for non-USD currencies', () => {
    const usdFee = calculateStripeFee(10000, 'usd');
    const hkdFee = calculateStripeFee(10000, 'hkd');
    expect(hkdFee - usdFee).toBe(100);
  });
});
