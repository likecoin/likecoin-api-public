import {
  describe, it, expect,
} from 'vitest';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import { ValidationError } from '../../src/util/ValidationError';
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

describe('NFT Book Purchase - calculateItemPrices', () => {
  describe('Custom Price and Tipping', () => {
    it('should calculate tip fee at 10% of tip amount', () => {
      const item = createMockItem({
        priceInDecimal: 15000,
        originalPriceInDecimal: 10000,
        customPriceDiffInDecimal: 5000,
      });
      const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.customPriceDiffInDecimal).toBe(5000);
      expect(result.likerLandTipFeeAmount).toBe(500);
    });

    it('should return zero tip fee when no custom price', () => {
      const item = createMockItem({
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
        customPriceDiffInDecimal: 0,
      });
      const [result] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(result.customPriceDiffInDecimal).toBe(0);
      expect(result.likerLandTipFeeAmount).toBe(0);
    });
  });

  describe('Item Prices for Cart Payments', () => {
    it('should calculate fees for liker_land channel', () => {
      const item = createMockItem({
        classId: 'class-1',
        priceIndex: 0,
        quantity: 1,
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
      });
      const itemPrices = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);

      expect(itemPrices).toHaveLength(1);
      expect(itemPrices[0].likerLandCommission).toBe(3000);
      expect(itemPrices[0].channelCommission).toBe(0);
      expect(itemPrices[0].likerLandFeeAmount).toBe(500);
    });

    it('should calculate fees for external channel with tip', () => {
      const item = createMockItem({
        classId: 'class-2',
        priceIndex: 1,
        quantity: 2,
        priceInDecimal: 15000,
        customPriceDiffInDecimal: 5000,
        originalPriceInDecimal: 10000,
      });
      const itemPrices = calculateItemPrices([item], '@external_channel');

      expect(itemPrices).toHaveLength(1);
      expect(itemPrices[0].likerLandCommission).toBe(0);
      expect(itemPrices[0].channelCommission).toBe(3000);
      expect(itemPrices[0].likerLandTipFeeAmount).toBe(500);
      expect(itemPrices[0].likerLandFeeAmount).toBe(500);
    });
  });

  describe('Fee Info and Royalty Calculation', () => {
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
});

describe('ValidationError', () => {
  it('should create error with message and default status 400', () => {
    const error = new ValidationError('CLASS_ID_NOT_FOUND');
    expect(error.message).toBe('CLASS_ID_NOT_FOUND');
    expect(error.name).toBe('ValidationError');
    expect(error.status).toBe(400);
  });

  it('should create error with custom status code', () => {
    const error = new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
    expect(error.message).toBe('PAYMENT_ID_NOT_FOUND');
    expect(error.status).toBe(404);
  });
});

describe('NFT Book Purchase - Fee Breakdown Examples', () => {
  it('should match author direct sale: $100 book (~90.3% royalty)', () => {
    const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
    const [result] = calculateItemPrices([item], LIKER_LAND_WAIVED_CHANNEL);
    const stripeFee = calculateStripeFee(10000);

    expect(result.likerLandFeeAmount).toBe(500);
    expect(result.likerLandCommission).toBe(0);
    expect(result.channelCommission).toBe(0);
    expect(stripeFee).toBe(470);

    const totalFees = result.likerLandFeeAmount + stripeFee;
    const royalty = 10000 - totalFees;

    expect(totalFees).toBe(970);
    expect(royalty).toBe(9030);
  });

  it('should match third-party channel sale: $100 book (~60.3% royalty)', () => {
    const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });
    const [result] = calculateItemPrices([item], '@bookstore');
    const stripeFee = calculateStripeFee(10000);

    expect(result.channelCommission).toBe(3000);
    expect(result.likerLandFeeAmount).toBe(500);
    expect(result.likerLandCommission).toBe(0);
    expect(stripeFee).toBe(470);

    const totalFees = result.channelCommission + result.likerLandFeeAmount + stripeFee;
    const royalty = 10000 - totalFees;

    expect(totalFees).toBe(3970);
    expect(royalty).toBe(6030);
  });

  it('should route commission to correct recipient based on channel', () => {
    const item = createMockItem({ priceInDecimal: 10000, originalPriceInDecimal: 10000 });

    const [likerLandResult] = calculateItemPrices([item], NFT_BOOK_DEFAULT_FROM_CHANNEL);
    expect(likerLandResult.likerLandCommission).toBe(3000);
    expect(likerLandResult.channelCommission).toBe(0);

    const [externalResult] = calculateItemPrices([item], '@bookstore');
    expect(externalResult.likerLandCommission).toBe(0);
    expect(externalResult.channelCommission).toBe(3000);

    const [waivedResult] = calculateItemPrices([item], LIKER_LAND_WAIVED_CHANNEL);
    expect(waivedResult.likerLandCommission).toBe(0);
    expect(waivedResult.channelCommission).toBe(0);
  });
});
