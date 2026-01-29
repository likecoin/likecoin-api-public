import {
  describe, it, expect,
} from 'vitest';
import { calculateStripeFee, normalizeLanguageForStripeLocale } from '../../src/util/stripe';
import { checkIsFromLikerLand, calculateItemPrices } from '../../src/util/api/likernft/book/price';

const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';
const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

describe('NFT Book Purchase - Stripe Fee Calculations', () => {
  describe('calculateStripeFee', () => {
    it('should return 0 for zero amount', () => {
      const result = calculateStripeFee(0);
      expect(result).toBe(0);
    });

    it('should calculate Stripe fee for USD payments (4.4% + $0.30)', () => {
      const amountInCents = 10000;
      const result = calculateStripeFee(amountInCents, 'usd');
      expect(result).toBe(470);
    });

    it('should match documented example: $100 book = $4.70 Stripe fee', () => {
      const bookPrice = 10000;
      const result = calculateStripeFee(bookPrice, 'usd');
      expect(result).toBe(470);
    });

    it('should calculate Stripe fee for non-USD payments with additional 1% FX fee', () => {
      const amountInCents = 10000;
      const result = calculateStripeFee(amountInCents, 'hkd');
      expect(result).toBe(570);
    });

    it('should calculate Stripe fee for small amounts', () => {
      const amountInCents = 100;
      const result = calculateStripeFee(amountInCents, 'usd');
      expect(result).toBe(35);
    });

    it('should calculate Stripe fee for minimum price ($0.99)', () => {
      const amountInCents = 99;
      const result = calculateStripeFee(amountInCents, 'usd');
      expect(result).toBe(35);
    });

    it('should calculate Stripe fee for large amounts', () => {
      const amountInCents = 100000;
      const result = calculateStripeFee(amountInCents, 'usd');
      expect(result).toBe(4430);
    });

    it('should add 1% FX fee for TWD currency', () => {
      const amountInCents = 10000;
      const resultUSD = calculateStripeFee(amountInCents, 'usd');
      const resultTWD = calculateStripeFee(amountInCents, 'twd');
      expect(resultTWD - resultUSD).toBe(100);
    });
  });
});

describe('NFT Book Purchase - Language Normalization', () => {
  describe('normalizeLanguageForStripeLocale', () => {
    it('should normalize zh to zh-TW', () => {
      const result = normalizeLanguageForStripeLocale('zh');
      expect(result).toBe('zh-TW');
    });

    it('should normalize zh-Hant to zh-TW', () => {
      const result = normalizeLanguageForStripeLocale('zh-Hant');
      expect(result).toBe('zh-TW');
    });

    it('should pass through zh-TW', () => {
      const result = normalizeLanguageForStripeLocale('zh-TW');
      expect(result).toBe('zh-TW');
    });

    it('should pass through en', () => {
      const result = normalizeLanguageForStripeLocale('en');
      expect(result).toBe('en');
    });

    it('should pass through zh-HK', () => {
      const result = normalizeLanguageForStripeLocale('zh-HK');
      expect(result).toBe('zh-HK');
    });

    it('should return auto for unsupported languages', () => {
      const result = normalizeLanguageForStripeLocale('fr');
      expect(result).toBe('auto');
    });

    it('should return auto for undefined', () => {
      const result = normalizeLanguageForStripeLocale(undefined);
      expect(result).toBe('auto');
    });
  });
});

describe('NFT Book Purchase - Check LikerLand Source', () => {
  describe('checkIsFromLikerLand', () => {
    it('should return true for liker_land default channel', () => {
      const result = checkIsFromLikerLand('liker_land');
      expect(result).toBe(true);
    });

    it('should return false for external channel referrers', () => {
      const result = checkIsFromLikerLand('@someuser');
      expect(result).toBe(false);
    });

    it('should return false for waived channel', () => {
      const result = checkIsFromLikerLand(LIKER_LAND_WAIVED_CHANNEL);
      expect(result).toBe(false);
    });

    it('should return false for undefined', () => {
      const result = checkIsFromLikerLand(undefined as any);
      expect(result).toBe(false);
    });

    it('should return false for empty string', () => {
      const result = checkIsFromLikerLand('');
      expect(result).toBe(false);
    });
  });
});

describe('NFT Book Purchase - Item Price Calculations', () => {
  describe('calculateItemPrices', () => {
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

    describe('Direct sales through liker_land channel', () => {
      it('should calculate fees for $100 book sold via liker_land', () => {
        const result = calculateItemPrices([mockItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.likerLandTipFeeAmount).toBe(0);
        expect(item.likerLandCommission).toBe(3000);
        expect(item.channelCommission).toBe(0);
        expect(item.likerLandArtFee).toBe(0);
      });
    });

    describe('Sales through third-party channels', () => {
      it('should calculate channel commission for external referrer', () => {
        const result = calculateItemPrices([mockItem], '@bookstore_channel');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.channelCommission).toBe(3000);
        expect(item.likerLandCommission).toBe(0);
      });

      it('should apply channel commission for KOL referrer', () => {
        const result = calculateItemPrices([mockItem], '@kol_influencer');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.channelCommission).toBe(3000);
        expect(item.likerLandCommission).toBe(0);
      });
    });

    describe('Waived commission channel', () => {
      it('should waive all commission for liker_land_waived channel', () => {
        const result = calculateItemPrices([mockItem], LIKER_LAND_WAIVED_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.channelCommission).toBe(0);
        expect(item.likerLandCommission).toBe(0);
      });
    });

    describe('Custom price / Tipping', () => {
      it('should calculate tip fee at 10% of tip amount', () => {
        const itemWithTip = {
          ...mockItem,
          priceInDecimal: 15000,
          customPriceDiffInDecimal: 5000,
        };
        const result = calculateItemPrices([itemWithTip], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.likerLandTipFeeAmount).toBe(500);
        expect(item.likerLandCommission).toBe(3000);
      });

      it('should handle tip on channel sales', () => {
        const itemWithTip = {
          ...mockItem,
          priceInDecimal: 12000,
          customPriceDiffInDecimal: 2000,
        };
        const result = calculateItemPrices([itemWithTip], '@referrer');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandTipFeeAmount).toBe(200);
        expect(item.channelCommission).toBe(3000);
        expect(item.likerLandCommission).toBe(0);
      });
    });

    describe('LikerLand Art fee', () => {
      it('should apply 10% art fee for LikerLand Art items', () => {
        const artItem = {
          ...mockItem,
          isLikerLandArt: true,
        };
        const result = calculateItemPrices([artItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandArtFee).toBe(1000);
        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.likerLandCommission).toBe(3000);
      });

      it('should not apply art fee for regular books', () => {
        const result = calculateItemPrices([mockItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result[0].likerLandArtFee).toBe(0);
      });
    });

    describe('Free items', () => {
      it('should waive all fees for free items', () => {
        const freeItem = {
          ...mockItem,
          priceInDecimal: 0,
          customPriceDiffInDecimal: 0,
          originalPriceInDecimal: 0,
        };
        const result = calculateItemPrices([freeItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(0);
        expect(item.likerLandTipFeeAmount).toBe(0);
        expect(item.likerLandCommission).toBe(0);
        expect(item.channelCommission).toBe(0);
        expect(item.likerLandArtFee).toBe(0);
      });

      it('should still charge tip fee on free book with tip', () => {
        const freeItemWithTip = {
          ...mockItem,
          priceInDecimal: 1000,
          customPriceDiffInDecimal: 1000,
          originalPriceInDecimal: 0,
        };
        const result = calculateItemPrices([freeItemWithTip], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandTipFeeAmount).toBe(100);
      });
    });

    describe('Discounted prices', () => {
      it('should reduce channel commission by discount amount', () => {
        const discountedItem = {
          ...mockItem,
          priceInDecimal: 7000,
          originalPriceInDecimal: 10000,
        };
        const result = calculateItemPrices([discountedItem], '@referrer');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.channelCommission).toBe(0);
        expect(item.likerLandFeeAmount).toBe(500);
      });

      it('should partially reduce commission for smaller discounts', () => {
        const discountedItem = {
          ...mockItem,
          priceInDecimal: 8000,
          originalPriceInDecimal: 10000,
        };
        const result = calculateItemPrices([discountedItem], '@referrer');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.channelCommission).toBe(1000);
      });

      it('should ensure commission never goes negative with large discount', () => {
        const heavyDiscountItem = {
          ...mockItem,
          priceInDecimal: 5000,
          originalPriceInDecimal: 10000,
        };
        const result = calculateItemPrices([heavyDiscountItem], '@referrer');
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.channelCommission).toBe(0);
      });
    });

    describe('Multi-item calculations', () => {
      it('should handle multiple items with different configurations', () => {
        const item1 = { ...mockItem, priceInDecimal: 10000, originalPriceInDecimal: 10000 };
        const item2 = {
          ...mockItem,
          classId: 'test-class-id-2',
          priceInDecimal: 20000,
          originalPriceInDecimal: 20000,
          isLikerLandArt: true,
        };
        const item3 = {
          ...mockItem,
          classId: 'test-class-id-3',
          priceInDecimal: 7000,
          customPriceDiffInDecimal: 2000,
          originalPriceInDecimal: 5000,
        };

        const result = calculateItemPrices([item1, item2, item3], '@referrer');
        expect(result).toHaveLength(3);

        expect(result[0].channelCommission).toBe(3000);
        expect(result[0].likerLandArtFee).toBe(0);

        expect(result[1].likerLandArtFee).toBe(2000);
        expect(result[1].channelCommission).toBe(6000);

        expect(result[2].likerLandTipFeeAmount).toBe(200);
        expect(result[2].channelCommission).toBe(1500);
        expect(result[2].likerLandFeeAmount).toBe(250);
      });

      it('should calculate per-unit fees (quantity separate)', () => {
        const multiQtyItem = {
          ...mockItem,
          quantity: 3,
          priceInDecimal: 10000,
          originalPriceInDecimal: 10000,
        };
        const result = calculateItemPrices([multiQtyItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.quantity).toBe(3);
        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.likerLandCommission).toBe(3000);
      });
    });

    describe('Complex scenarios', () => {
      it('should handle LikerLand Art with custom tip', () => {
        const complexItem = {
          ...mockItem,
          priceInDecimal: 18000,
          customPriceDiffInDecimal: 5000,
          originalPriceInDecimal: 13000,
          isLikerLandArt: true,
        };
        const result = calculateItemPrices([complexItem], NFT_BOOK_DEFAULT_FROM_CHANNEL);
        expect(result).toHaveLength(1);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(650);
        expect(item.likerLandTipFeeAmount).toBe(500);
        expect(item.likerLandCommission).toBe(3900);
        expect(item.likerLandArtFee).toBe(1300);
      });

      it('should verify documented $100 book fee breakdown (author direct)', () => {
        const result = calculateItemPrices([mockItem], LIKER_LAND_WAIVED_CHANNEL);
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.likerLandCommission).toBe(0);
        expect(item.channelCommission).toBe(0);

        const stripeFee = calculateStripeFee(10000, 'usd');
        expect(stripeFee).toBe(470);

        const totalFees = item.likerLandFeeAmount + stripeFee;
        expect(totalFees).toBe(970);

        const royalty = 10000 - totalFees;
        expect(royalty).toBe(9030);
      });

      it('should verify documented $100 book fee breakdown (third-party channel)', () => {
        const result = calculateItemPrices([mockItem], '@bookstore');
        const [item] = result;

        expect(item.likerLandFeeAmount).toBe(500);
        expect(item.channelCommission).toBe(3000);
        expect(item.likerLandCommission).toBe(0);

        const stripeFee = calculateStripeFee(10000, 'usd');
        expect(stripeFee).toBe(470);

        const totalFees = item.likerLandFeeAmount + item.channelCommission + stripeFee;
        expect(totalFees).toBe(3970);

        const royalty = 10000 - totalFees;
        expect(royalty).toBe(6030);
      });
    });
  });
});
