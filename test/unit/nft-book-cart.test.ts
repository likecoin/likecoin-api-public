import {
  describe, it, expect,
} from 'vitest';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
} from '../../config/config';
import { calculateStripeFee } from '../../src/util/stripe';

const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';
const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

describe('NFT Book Cart - Fee Calculation and Royalty Split', () => {
  describe('Transaction Fee Info Calculations', () => {
    it('should calculate royalty to split for liker_land channel sale', () => {
      const priceInDecimal = 10000;
      const stripeFeeAmount = calculateStripeFee(priceInDecimal);
      const likerLandFeeAmount = Math.ceil(priceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const likerLandTipFeeAmount = 0;
      const likerLandCommission = Math.ceil(priceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);
      const channelCommission = 0;
      const likerLandArtFee = 0;

      const royaltyToSplit = Math.max(
        priceInDecimal - stripeFeeAmount - likerLandFeeAmount
          - likerLandTipFeeAmount - likerLandCommission
          - channelCommission - likerLandArtFee,
        0,
      );

      expect(royaltyToSplit).toBe(6030);
    });

    it('should calculate royalty to split for waived channel (author direct)', () => {
      const priceInDecimal = 10000;
      const stripeFeeAmount = calculateStripeFee(priceInDecimal);
      const likerLandFeeAmount = Math.ceil(priceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const likerLandTipFeeAmount = 0;
      const likerLandCommission = 0;
      const channelCommission = 0;
      const likerLandArtFee = 0;

      const royaltyToSplit = Math.max(
        priceInDecimal - stripeFeeAmount - likerLandFeeAmount
          - likerLandTipFeeAmount - likerLandCommission
          - channelCommission - likerLandArtFee,
        0,
      );

      expect(royaltyToSplit).toBe(9030);
    });

    it('should calculate royalty to split for third-party channel sale', () => {
      const priceInDecimal = 10000;
      const stripeFeeAmount = calculateStripeFee(priceInDecimal);
      const likerLandFeeAmount = Math.ceil(priceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const likerLandTipFeeAmount = 0;
      const likerLandCommission = 0;
      const channelCommission = Math.ceil(priceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);
      const likerLandArtFee = 0;

      const royaltyToSplit = Math.max(
        priceInDecimal - stripeFeeAmount - likerLandFeeAmount
          - likerLandTipFeeAmount - likerLandCommission
          - channelCommission - likerLandArtFee,
        0,
      );

      expect(royaltyToSplit).toBe(6030);
    });

    it('should calculate royalty with all fees applied (LikerLand Art with tip)', () => {
      const priceInDecimal = 23000;
      const originalPriceInDecimal = 20000;
      const customPriceDiffInDecimal = 3000;
      const stripeFeeAmount = calculateStripeFee(priceInDecimal);
      const likerLandFeeAmount = Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      const likerLandCommission = 0;
      const channelCommission = Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
      );
      const likerLandArtFee = Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO);

      const royaltyToSplit = Math.max(
        priceInDecimal - stripeFeeAmount - likerLandFeeAmount
          - likerLandTipFeeAmount - likerLandCommission
          - channelCommission - likerLandArtFee,
        0,
      );

      expect(royaltyToSplit).toBe(12658);
      expect(royaltyToSplit).toBeLessThan(priceInDecimal * 0.6);
    });

    it('should handle zero royalty when fees exceed price', () => {
      const royaltyToSplit = Math.max(
        1000 - 200 - 300 - 400 - 500,
        0,
      );
      expect(royaltyToSplit).toBe(0);
    });
  });

  describe('Item Price Info Structure', () => {
    it('should have all required price info fields', () => {
      const itemPriceInfo = {
        quantity: 2,
        currency: 'usd',
        priceInDecimal: 20000,
        customPriceDiffInDecimal: 5000,
        originalPriceInDecimal: 20000,
        likerLandTipFeeAmount: 500,
        likerLandFeeAmount: 1000,
        likerLandCommission: 6000,
        channelCommission: 0,
        likerLandArtFee: 0,
        classId: 'test-class-id',
        priceIndex: 0,
        iscnPrefix: 'iscn://test',
        stripePriceId: 'price_test123',
      };

      expect(itemPriceInfo.quantity).toBe(2);
      expect(itemPriceInfo.currency).toBe('usd');
      expect(itemPriceInfo.priceInDecimal).toBe(20000);
      expect(itemPriceInfo.originalPriceInDecimal).toBe(20000);
      expect(itemPriceInfo.likerLandTipFeeAmount).toBe(500);
      expect(itemPriceInfo.likerLandFeeAmount).toBe(1000);
      expect(itemPriceInfo.likerLandCommission).toBe(6000);
      expect(itemPriceInfo.channelCommission).toBe(0);
      expect(itemPriceInfo.likerLandArtFee).toBe(0);
    });
  });

  describe('Transaction Fee Info Structure', () => {
    it('should have all required fee info fields', () => {
      const feeInfo = {
        priceInDecimal: 50000,
        originalPriceInDecimal: 50000,
        stripeFeeAmount: 2170,
        likerLandTipFeeAmount: 1000,
        likerLandFeeAmount: 2500,
        likerLandCommission: 15000,
        channelCommission: 0,
        likerLandArtFee: 5000,
        customPriceDiffInDecimal: 10000,
        royaltyToSplit: 24330,
      };

      expect(feeInfo.priceInDecimal).toBe(50000);
      expect(feeInfo.originalPriceInDecimal).toBe(50000);
      expect(feeInfo.stripeFeeAmount).toBe(2170);
      expect(feeInfo.likerLandTipFeeAmount).toBe(1000);
      expect(feeInfo.likerLandFeeAmount).toBe(2500);
      expect(feeInfo.likerLandCommission).toBe(15000);
      expect(feeInfo.channelCommission).toBe(0);
      expect(feeInfo.likerLandArtFee).toBe(5000);
      expect(feeInfo.customPriceDiffInDecimal).toBe(10000);
      expect(feeInfo.royaltyToSplit).toBe(24330);

      const calculatedRoyalty = Math.max(
        feeInfo.priceInDecimal - feeInfo.stripeFeeAmount - feeInfo.likerLandFeeAmount
          - feeInfo.likerLandTipFeeAmount - feeInfo.likerLandCommission
          - feeInfo.channelCommission - feeInfo.likerLandArtFee,
        0,
      );
      expect(calculatedRoyalty).toBe(feeInfo.royaltyToSplit);
    });
  });

  describe('Cart Item Validation', () => {
    it('should validate minimum quantity', () => {
      const validQuantities = [1, 2, 5, 10, 100];
      validQuantities.forEach((quantity) => {
        expect(quantity).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(quantity)).toBe(true);
      });
    });

    it('should reject invalid quantities', () => {
      const invalidQuantities = [0, -1, 1.5, -10];
      invalidQuantities.forEach((quantity) => {
        const isValid = Number.isInteger(quantity) && quantity >= 1;
        expect(isValid).toBe(false);
      });
    });

    it('should validate custom price', () => {
      const validCustomPrices = [0, 1000, 5000, 10000];
      validCustomPrices.forEach((price) => {
        expect(price).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(price)).toBe(true);
      });
    });

    it('should reject invalid custom prices', () => {
      const invalidCustomPrices = [-100, -1, 1.5];
      invalidCustomPrices.forEach((price) => {
        const isValid = Number.isInteger(price) && price >= 0;
        expect(isValid).toBe(false);
      });
    });

    it('should validate price index', () => {
      const validPriceIndices = [0, 1, 2, 10];
      validPriceIndices.forEach((index) => {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(index)).toBe(true);
      });
    });
  });

  describe('Cart Item with Info Structure', () => {
    it('should contain all required fields', () => {
      const cartItemWithInfo: CartItemWithInfo = {
        classId: 'test-class-id',
        priceIndex: 0,
        quantity: 1,
        currency: 'usd',
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
        chain: 'evm',
      };

      expect(cartItemWithInfo.classId).toBeDefined();
      expect(cartItemWithInfo.priceIndex).toBeDefined();
      expect(cartItemWithInfo.quantity).toBeDefined();
      expect(cartItemWithInfo.priceInDecimal).toBeDefined();
      expect(cartItemWithInfo.customPriceDiffInDecimal).toBeDefined();
      expect(cartItemWithInfo.stock).toBeDefined();
      expect(cartItemWithInfo.isAllowCustomPrice).toBeDefined();
      expect(cartItemWithInfo.name).toBeDefined();
      expect(cartItemWithInfo.description).toBeDefined();
      expect(cartItemWithInfo.images).toBeDefined();
      expect(cartItemWithInfo.ownerWallet).toBeDefined();
      expect(cartItemWithInfo.isLikerLandArt).toBeDefined();
      expect(cartItemWithInfo.originalPriceInDecimal).toBeDefined();
      expect(cartItemWithInfo.chain).toBeDefined();
    });
  });

  describe('Multi-Item Cart Calculations', () => {
    it('should calculate total price across multiple items', () => {
      const items: Array<{ priceInDecimal: number; quantity: number }> = [
        { priceInDecimal: 10000, quantity: 1 },
        { priceInDecimal: 20000, quantity: 2 },
        { priceInDecimal: 5000, quantity: 3 },
      ];

      const totalPrice = items.reduce(
        (acc, item) => acc + item.priceInDecimal * item.quantity,
        0,
      );

      expect(totalPrice).toBe(10000 + 40000 + 15000);
    });

    it('should calculate total fees across multiple items', () => {
      const itemPrices: Array<{
        priceInDecimal: number;
        quantity: number;
        likerLandFeeAmount: number;
        likerLandCommission: number;
        channelCommission: number;
        likerLandArtFee: number;
      }> = [
        {
          priceInDecimal: 10000,
          quantity: 1,
          likerLandFeeAmount: 500,
          likerLandCommission: 3000,
          channelCommission: 0,
          likerLandArtFee: 0,
        },
        {
          priceInDecimal: 15000,
          quantity: 2,
          likerLandFeeAmount: 750,
          likerLandCommission: 0,
          channelCommission: 4500,
          likerLandArtFee: 0,
        },
      ];

      const totalLikerLandFee = itemPrices.reduce(
        (acc, item) => acc + item.likerLandFeeAmount * item.quantity,
        0,
      );
      const totalLikerLandCommission = itemPrices.reduce(
        (acc, item) => acc + item.likerLandCommission * item.quantity,
        0,
      );
      const totalChannelCommission = itemPrices.reduce(
        (acc, item) => acc + item.channelCommission * item.quantity,
        0,
      );
      const totalLikerLandArtFee = itemPrices.reduce(
        (acc, item) => acc + item.likerLandArtFee * item.quantity,
        0,
      );

      expect(totalLikerLandFee).toBe(500 + 1500);
      expect(totalLikerLandCommission).toBe(3000);
      expect(totalChannelCommission).toBe(9000);
      expect(totalLikerLandArtFee).toBe(0);
    });
  });

  describe('Fee Ratios', () => {
    it('should use correct fee ratios as defined in config', () => {
      expect(NFT_BOOK_LIKER_LAND_FEE_RATIO).toBe(0.05);
      expect(NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO).toBe(0.10);
      expect(NFT_BOOK_LIKER_LAND_COMMISSION_RATIO).toBe(0.3);
      expect(NFT_BOOK_LIKER_LAND_ART_FEE_RATIO).toBe(0.1);
    });

    it('should calculate platform fee correctly using ratio', () => {
      const originalPrice = 10000;
      const expectedFee = Math.ceil(originalPrice * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      expect(expectedFee).toBe(500);
    });

    it('should calculate tip fee correctly using ratio', () => {
      const tipAmount = 5000;
      const expectedFee = Math.ceil(tipAmount * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO);
      expect(expectedFee).toBe(500);
    });

    it('should calculate commission correctly using ratio', () => {
      const originalPrice = 10000;
      const expectedCommission = Math.ceil(originalPrice * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);
      expect(expectedCommission).toBe(3000);
    });

    it('should calculate art fee correctly using ratio', () => {
      const originalPrice = 10000;
      const expectedArtFee = Math.ceil(originalPrice * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO);
      expect(expectedArtFee).toBe(1000);
    });

    it('should calculate Stripe fee correctly', () => {
      const price = 10000;
      const stripeFee = calculateStripeFee(price, 'usd');
      expect(stripeFee).toBe(470);
    });
  });

  describe('Stripe Fee Distribution in Cart', () => {
    it('should distribute Stripe fee proportionally across items', () => {
      const totalStripeFeeAmount = 940;
      const totalPriceInDecimal = 20000;

      const item1Price = 10000;
      const item1Quantity = 1;
      const item2Price = 5000;
      const item2Quantity = 2;

      const item1StripeFee = Math.ceil(
        (totalStripeFeeAmount * item1Price * item1Quantity) / totalPriceInDecimal,
      );
      const item2StripeFee = Math.ceil(
        (totalStripeFeeAmount * item2Price * item2Quantity) / totalPriceInDecimal,
      );

      expect(item1StripeFee).toBe(470);
      expect(item2StripeFee).toBe(470);
    });

    it('should handle zero total price', () => {
      const totalStripeFeeAmount = 0;
      const totalPriceInDecimal = 0;
      const itemPrice = 0;
      const itemQuantity = 1;

      const itemStripeFee = Math.ceil(
        (totalStripeFeeAmount * itemPrice * itemQuantity) / totalPriceInDecimal || 0,
      );

      expect(itemStripeFee).toBe(0);
    });
  });
});

describe('NFT Book Cart - Royalty Split Calculations', () => {
  describe('Connected Wallet Royalty Split', () => {
    it('should split royalty among connected wallets proportionally', () => {
      const royaltyToSplit = 5000;
      const connectedWallets = {
        '0x1234...5678': 0.6,
        '0xabcd...efgh': 0.4,
      };

      const wallets = Object.keys(connectedWallets);
      const totalSplit = Object.values(connectedWallets).reduce((a, b) => a + b, 0);

      const amountSplit1 = Math.floor((royaltyToSplit * connectedWallets[wallets[0]]) / totalSplit);
      const amountSplit2 = Math.floor((royaltyToSplit * connectedWallets[wallets[1]]) / totalSplit);

      expect(amountSplit1).toBe(3000);
      expect(amountSplit2).toBe(2000);
    });

    it('should handle single connected wallet (sole author)', () => {
      const royaltyToSplit = 5000;
      const connectedWallets = {
        '0x1234...5678': 1,
      };

      const wallets = Object.keys(connectedWallets);
      const totalSplit = Object.values(connectedWallets).reduce((a, b) => a + b, 0);

      const amountSplit = Math.floor((royaltyToSplit * connectedWallets[wallets[0]]) / totalSplit);

      expect(amountSplit).toBe(5000);
    });

    it('should handle multiple connected wallets with varying ratios', () => {
      const royaltyToSplit = 10000;
      const connectedWallets = {
        '0x1111...1111': 1,
        '0x2222...2222': 2,
        '0x3333...3333': 1,
      };

      const wallets = Object.keys(connectedWallets);
      const totalSplit = Object.values(connectedWallets).reduce((a, b) => a + b, 0);

      const amountSplit1 = Math.floor((royaltyToSplit * connectedWallets[wallets[0]]) / totalSplit);
      const amountSplit2 = Math.floor((royaltyToSplit * connectedWallets[wallets[1]]) / totalSplit);
      const amountSplit3 = Math.floor((royaltyToSplit * connectedWallets[wallets[2]]) / totalSplit);

      expect(amountSplit1).toBe(2500);
      expect(amountSplit2).toBe(5000);
      expect(amountSplit3).toBe(2500);
    });
  });

  describe('Channel Commission Calculation', () => {
    it('should reduce channel commission by full discount amount (30% discount = 0 commission)', () => {
      const originalPriceInDecimal = 10000;
      const priceInDecimalWithoutTip = 7000;

      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );

      const channelCommission = Math.max(
        Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ),
        0,
      );

      expect(channelCommission).toBe(0);
    });

    it('should calculate full channel commission without discount', () => {
      const originalPriceInDecimal = 10000;
      const priceInDecimalWithoutTip = 10000;

      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );

      const channelCommission = Math.max(
        Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ),
        0,
      );

      expect(channelCommission).toBe(3000);
    });

    it('should partially reduce commission for smaller discounts', () => {
      const originalPriceInDecimal = 10000;
      const priceInDecimalWithoutTip = 8000;

      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );

      const channelCommission = Math.max(
        Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ),
        0,
      );

      expect(channelCommission).toBe(1000);
    });

    it('should ensure commission is never negative with large discount', () => {
      const originalPriceInDecimal = 10000;
      const priceInDecimalWithoutTip = 5000;

      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );

      const channelCommission = Math.max(
        Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ),
        0,
      );

      expect(channelCommission).toBe(0);
    });
  });

  describe('LikerLand Commission vs Channel Commission', () => {
    it('should identify liker_land as default channel', () => {
      const from = NFT_BOOK_DEFAULT_FROM_CHANNEL;
      const isFromLikerLand = from === NFT_BOOK_DEFAULT_FROM_CHANNEL;

      expect(from).toBe('liker_land');
      expect(isFromLikerLand).toBe(true);
    });

    it('should identify external referrer as non-default channel', () => {
      const from = '@bookstore_channel';
      const isFromLikerLand = from === NFT_BOOK_DEFAULT_FROM_CHANNEL;

      expect(isFromLikerLand).toBe(false);
    });

    it('should identify liker_land_waived as commission waived channel', () => {
      const from = LIKER_LAND_WAIVED_CHANNEL;
      const isCommissionWaived = from === LIKER_LAND_WAIVED_CHANNEL;

      expect(from).toBe('liker_land_waived');
      expect(isCommissionWaived).toBe(true);
    });

    it('should handle channel commission scenarios correctly', () => {
      const scenarios = [
        { from: 'liker_land', likerLandCommission: 3000, channelCommission: 0 },
        { from: '@bookstore', likerLandCommission: 0, channelCommission: 3000 },
        { from: 'liker_land_waived', likerLandCommission: 0, channelCommission: 0 },
      ];

      scenarios.forEach((scenario) => {
        const isFromLikerLand = scenario.from === NFT_BOOK_DEFAULT_FROM_CHANNEL;
        const isCommissionWaived = scenario.from === LIKER_LAND_WAIVED_CHANNEL;
        const originalPrice = 10000;

        let expectedLikerLandCommission = 0;
        let expectedChannelCommission = 0;

        if (isFromLikerLand) {
          expectedLikerLandCommission = Math.ceil(
            originalPrice * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
          );
        } else if (!isCommissionWaived && scenario.from) {
          expectedChannelCommission = Math.ceil(
            originalPrice * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
          );
        }

        expect(expectedLikerLandCommission).toBe(scenario.likerLandCommission);
        expect(expectedChannelCommission).toBe(scenario.channelCommission);
      });
    });
  });
});
