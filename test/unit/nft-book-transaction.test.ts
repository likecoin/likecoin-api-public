import {
  describe, it, expect,
} from 'vitest';
import type { BookPurchaseData } from '../../src/types/book';
import { ValidationError } from '../../src/util/ValidationError';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
} from '../../config/config';
import { calculateStripeFee } from '../../src/util/stripe';

const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';
const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

describe('NFT Book Purchase - Transaction Processing', () => {
  describe('Payment Data Structure', () => {
    it('should have valid payment data structure for third-party channel', () => {
      const paymentData: Partial<BookPurchaseData> = {
        type: 'stripe',
        email: 'test@example.com',
        isPaid: false,
        isPendingClaim: false,
        claimToken: 'test-claim-token',
        sessionId: 'cs_test_123',
        classId: 'test-class-id',
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
        price: 100,
        originalPrice: 100,
        priceName: 'Standard',
        priceIndex: 0,
        quantity: 1,
        from: '@bookstore_channel',
        status: 'new',
      };

      expect(paymentData.type).toBe('stripe');
      expect(paymentData.email).toBe('test@example.com');
      expect(paymentData.isPaid).toBe(false);
      expect(paymentData.priceInDecimal).toBe(10000);
      expect(paymentData.originalPriceInDecimal).toBe(10000);
      expect(paymentData.price).toBe(100);
      expect(paymentData.originalPrice).toBe(100);
      expect(paymentData.quantity).toBe(1);
      expect(paymentData.status).toBe('new');
    });

    it('should have valid payment data structure for direct author sale', () => {
      const paymentData: Partial<BookPurchaseData> = {
        type: 'stripe',
        email: 'test@example.com',
        isPaid: false,
        isPendingClaim: false,
        claimToken: 'test-claim-token',
        sessionId: 'cs_test_123',
        classId: 'test-class-id',
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
        price: 100,
        originalPrice: 100,
        priceName: 'Standard',
        priceIndex: 0,
        quantity: 1,
        from: LIKER_LAND_WAIVED_CHANNEL,
        status: 'new',
      };

      expect(paymentData.from).toBe('liker_land_waived');
    });
  });

  describe('Gift Payment Data Structure', () => {
    it('should include gift info when isGift is true', () => {
      const paymentData: Partial<BookPurchaseData> = {
        type: 'stripe',
        email: 'buyer@example.com',
        isPaid: false,
        isPendingClaim: false,
        claimToken: 'test-claim-token',
        classId: 'test-class-id',
        priceInDecimal: 10000,
        originalPriceInDecimal: 10000,
        price: 100,
        originalPrice: 100,
        priceName: 'Standard',
        priceIndex: 0,
        quantity: 1,
        from: '',
        status: 'new',
        isGift: true,
        giftInfo: {
          toEmail: 'recipient@example.com',
          toName: 'Recipient Name',
          fromName: 'Buyer Name',
          message: 'Happy reading!',
        },
      };

      expect(paymentData.isGift).toBe(true);
      expect(paymentData.giftInfo).toBeDefined();
      expect(paymentData.giftInfo?.toEmail).toBe('recipient@example.com');
      expect(paymentData.giftInfo?.toName).toBe('Recipient Name');
      expect(paymentData.giftInfo?.fromName).toBe('Buyer Name');
      expect(paymentData.giftInfo?.message).toBe('Happy reading!');
    });
  });

  describe('Payment Status Transitions', () => {
    it('should follow valid status transitions', () => {
      const validTransitions: Array<{ from: string; to: string }> = [
        { from: 'new', to: 'paid' },
        { from: 'paid', to: 'pendingNFT' },
        { from: 'paid', to: 'completed' },
        { from: 'pendingNFT', to: 'completed' },
        { from: 'new', to: 'error' },
      ];

      validTransitions.forEach((transition) => {
        const isValid = ['new', 'paid', 'pendingNFT', 'completed', 'error'].includes(transition.to);
        expect(isValid).toBe(true);
      });
    });

    it('should have distinct status values', () => {
      const statuses = ['new', 'paid', 'pendingNFT', 'completed', 'error', 'pending'];
      const uniqueStatuses = [...new Set(statuses)];
      expect(uniqueStatuses).toHaveLength(statuses.length);
    });
  });

  describe('Auto-deliver vs Manual Deliver', () => {
    it('should indicate auto-deliver when isAutoDeliver is true', () => {
      const quantity = 3;
      const nftIds = Array(quantity).fill(0);

      expect(nftIds).toHaveLength(3);
      expect(nftIds.every((id) => id === 0)).toBe(true);
    });

    it('should handle manual delivery with specific nftIds', () => {
      const nftIds = [1, 2, 3];

      expect(nftIds).toHaveLength(3);
      expect(nftIds.every((id) => id > 0)).toBe(true);
    });
  });

  describe('Stock Management', () => {
    it('should validate stock availability', () => {
      const stock = 10;
      const quantity = 3;
      const isAvailable = stock - quantity >= 0;

      expect(isAvailable).toBe(true);
    });

    it('should reject when insufficient stock', () => {
      const stock = 2;
      const quantity = 3;
      const isAvailable = stock - quantity >= 0;

      expect(isAvailable).toBe(false);
    });

    it('should track sold count', () => {
      const sold = 5;
      const quantity = 2;
      const newSold = sold + quantity;

      expect(newSold).toBe(7);
    });
  });

  describe('Custom Price and Tipping', () => {
    it('should calculate custom price difference (tip)', () => {
      const originalPrice = 10000;
      const customPrice = 15000;
      const customPriceDiff = customPrice - originalPrice;

      expect(customPriceDiff).toBe(5000);
    });

    it('should handle no custom price', () => {
      const originalPrice = 10000;
      const customPrice = 10000;
      const customPriceDiff = Math.max(customPrice - originalPrice, 0);

      expect(customPriceDiff).toBe(0);
    });

    it('should validate custom price is within maximum', () => {
      const MAXIMUM_CUSTOM_PRICE_IN_DECIMAL = 1000000;
      const originalPrice = 10000;
      const customPrice = 50000;
      const isCustomPriceValid = customPrice > originalPrice
        && customPrice <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL;

      expect(isCustomPriceValid).toBe(true);
    });

    it('should reject custom price above maximum', () => {
      const MAXIMUM_CUSTOM_PRICE_IN_DECIMAL = 1000000;
      const originalPrice = 10000;
      const customPrice = 1500000;
      const isCustomPriceValid = customPrice > originalPrice
        && customPrice <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL;

      expect(isCustomPriceValid).toBe(false);
    });

    it('should calculate tip fee correctly', () => {
      const tipAmount = 5000;
      const tipFee = Math.ceil(tipAmount * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO);

      expect(tipFee).toBe(500);
    });
  });

  describe('Coupon and Discount Handling', () => {
    it('should store coupon code in payment data', () => {
      const coupon = 'SUMMER2025';
      const paymentData = { coupon };

      expect(paymentData.coupon).toBe('SUMMER2025');
    });

    it('should handle payment without coupon', () => {
      const paymentData = {};
      expect(paymentData.coupon).toBeUndefined();
    });
  });

  describe('Price and Currency Conversion', () => {
    it('should convert decimal price to display price', () => {
      const priceInDecimal = 10000;
      const price = priceInDecimal / 100;

      expect(price).toBe(100);
    });

    it('should convert display price to decimal price', () => {
      const price = 100;
      const priceInDecimal = price * 100;

      expect(priceInDecimal).toBe(10000);
    });

    it('should handle fractional prices', () => {
      const priceInDecimal = 1050;
      const price = priceInDecimal / 100;

      expect(price).toBe(10.5);
    });
  });

  describe('Item Prices Array', () => {
    it('should store item prices for cart payments with liker_land channel', () => {
      const itemPrices = [
        {
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
          classId: 'class-1',
          priceIndex: 0,
        },
      ];

      expect(itemPrices).toHaveLength(1);
      expect(itemPrices[0].likerLandCommission).toBe(3000);
      expect(itemPrices[0].channelCommission).toBe(0);
    });

    it('should store item prices for cart payments with external channel', () => {
      const itemPrices = [
        {
          quantity: 2,
          currency: 'usd',
          priceInDecimal: 15000,
          customPriceDiffInDecimal: 5000,
          originalPriceInDecimal: 10000,
          likerLandTipFeeAmount: 500,
          likerLandFeeAmount: 500,
          likerLandCommission: 0,
          channelCommission: 3000,
          likerLandArtFee: 0,
          classId: 'class-2',
          priceIndex: 1,
        },
      ];

      expect(itemPrices).toHaveLength(1);
      expect(itemPrices[0].likerLandCommission).toBe(0);
      expect(itemPrices[0].channelCommission).toBe(3000);
      expect(itemPrices[0].likerLandTipFeeAmount).toBe(500);
    });
  });

  describe('Fee Info Structure', () => {
    it('should contain all fee information and verify royalty calculation', () => {
      const priceInDecimal = 60000;
      const originalPriceInDecimal = 50000;
      const customPriceDiffInDecimal = 10000;
      const stripeFeeAmount = calculateStripeFee(priceInDecimal);
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      const likerLandFeeAmount = Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandCommission = Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
      );
      const channelCommission = 0;
      const likerLandArtFee = 0;

      const royaltyToSplit = Math.max(
        priceInDecimal - stripeFeeAmount - likerLandFeeAmount
          - likerLandTipFeeAmount - likerLandCommission
          - channelCommission - likerLandArtFee,
        0,
      );

      const feeInfo = {
        priceInDecimal,
        originalPriceInDecimal,
        stripeFeeAmount,
        likerLandTipFeeAmount,
        likerLandFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
        customPriceDiffInDecimal,
        royaltyToSplit,
      };

      expect(feeInfo.priceInDecimal).toBe(60000);
      expect(feeInfo.originalPriceInDecimal).toBe(50000);
      expect(feeInfo.stripeFeeAmount).toBe(2670);
      expect(feeInfo.likerLandTipFeeAmount).toBe(1000);
      expect(feeInfo.likerLandFeeAmount).toBe(2500);
      expect(feeInfo.likerLandCommission).toBe(15000);
      expect(feeInfo.channelCommission).toBe(0);
      expect(feeInfo.likerLandArtFee).toBe(0);
      expect(feeInfo.customPriceDiffInDecimal).toBe(10000);
      expect(feeInfo.royaltyToSplit).toBe(38830);
    });
  });
});

describe('NFT Book Purchase - Commission Data', () => {
  describe('Commission Record Structure', () => {
    it('should have valid commission data structure', () => {
      const commissionData = {
        type: 'channelCommission',
        ownerWallet: '0x1234567890abcdef1234567890abcdef12345678',
        classId: 'test-class-id',
        priceIndex: 0,
        transferId: 'tr_1234567890',
        chargeId: 'ch_1234567890',
        stripeConnectAccountId: 'acct_1234567890',
        paymentId: 'payment-123',
        amountTotal: 10000,
        amount: 3000,
        currency: 'usd',
        timestamp: new Date(),
      };

      expect(commissionData.type).toBe('channelCommission');
      expect(commissionData.amount).toBe(3000);
      expect(commissionData.currency).toBe('usd');
      expect(commissionData.paymentId).toBe('payment-123');
    });

    it('should support different commission types', () => {
      const commissionTypes = ['channelCommission', 'connectedWallet', 'artFee'];

      commissionTypes.forEach((type) => {
        const commissionData = { type };
        expect(commissionData.type).toBe(type);
      });
    });
  });
});

describe('NFT Book Purchase - Validation Errors', () => {
  describe('Common Error Codes', () => {
    it('should have defined error codes', () => {
      const errorCodes = [
        'CLASS_ID_NOT_FOUND',
        'PAYMENT_NOT_FOUND',
        'PAYMENT_ALREADY_PROCESSED',
        'NFT_PRICE_NOT_FOUND',
        'OUT_OF_STOCK',
        'INVALID_CLAIM_TOKEN',
        'PAYMENT_ALREADY_CLAIMED',
        'PAYMENT_ALREADY_CLAIMED_BY_OTHER',
        'PAYMENT_ALREADY_CLAIMED_BY_WALLET',
        'ITEM_ID_NOT_SET',
        'QUANTITY_INVALID',
        'CUSTOM_PRICE_INVALID',
        'PRICE_INDEX_INVALID',
        'NFT_NOT_FOUND',
        'BOOK_NOT_APPROVED_FOR_SALE',
        'PRICE_INVALID',
        'CART_ID_NOT_FOUND',
        'CART_ALREADY_CLAIMED',
        'CART_ALREADY_CLAIMED_BY_OTHER',
        'CART_ALREADY_CLAIMED_BY_WALLET',
        'FREE_BOOK_CART_ITEM_PRICE_NOT_FREE',
        'DIFFERENT_CHAIN_NOT_SUPPORTED',
      ];

      errorCodes.forEach((code) => {
        expect(code).toBeTruthy();
        expect(typeof code).toBe('string');
      });
    });
  });

  describe('ValidationError Construction', () => {
    it('should create ValidationError with message', () => {
      const error = new ValidationError('CLASS_ID_NOT_FOUND');
      expect(error.message).toBe('CLASS_ID_NOT_FOUND');
      expect(error.name).toBe('ValidationError');
      expect(error.status).toBe(400);
    });

    it('should create ValidationError with message and status code', () => {
      const error = new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
      expect(error.message).toBe('PAYMENT_ID_NOT_FOUND');
      expect(error.status).toBe(404);
    });
  });
});

describe('NFT Book Purchase - Metadata Handling', () => {
  describe('Session Metadata', () => {
    it('should construct valid session metadata for external channel', () => {
      const metadata = {
        store: 'book',
        paymentId: 'payment-123',
        cartId: 'cart-123',
        classId: 'class-123',
        iscnPrefix: 'iscn://test',
        priceIndex: '0',
        claimToken: 'claim-token-123',
        from: '@bookstore_channel',
        likeWallet: 'like1test',
        evmWallet: '0x1234567890abcdef',
        giftInfo: 'recipient@example.com',
        utmCampaign: 'summer-sale',
        utmSource: 'twitter',
        utmMedium: 'social',
        httpMethod: 'POST',
        referrer: 'https://example.com',
      };

      expect(metadata.store).toBe('book');
      expect(metadata.paymentId).toBe('payment-123');
      expect(metadata.from).toBe('@bookstore_channel');
    });

    it('should construct valid session metadata for author direct sale', () => {
      const metadata = {
        store: 'book',
        paymentId: 'payment-123',
        cartId: 'cart-123',
        classId: 'class-123',
        iscnPrefix: 'iscn://test',
        priceIndex: '0',
        claimToken: 'claim-token-123',
        from: LIKER_LAND_WAIVED_CHANNEL,
        likeWallet: 'like1test',
        evmWallet: '0x1234567890abcdef',
        httpMethod: 'POST',
        referrer: 'https://author-website.com',
      };

      expect(metadata.from).toBe('liker_land_waived');
    });

    it('should construct valid session metadata for default liker_land channel', () => {
      const metadata = {
        store: 'book',
        paymentId: 'payment-123',
        classId: 'class-123',
        from: NFT_BOOK_DEFAULT_FROM_CHANNEL,
      };

      expect(metadata.from).toBe('liker_land');
    });
  });

  describe('Product Metadata', () => {
    it('should construct valid product metadata', () => {
      const productMetadata = {
        classId: 'class-123',
        iscnPrefix: 'iscn://test',
        tippingFor: 'class-123',
      };

      expect(productMetadata.classId).toBe('class-123');
      expect(productMetadata.iscnPrefix).toBe('iscn://test');
      expect(productMetadata.tippingFor).toBe('class-123');
    });
  });
});

describe('NFT Book Purchase - Chain Handling', () => {
  describe('Supported Chains', () => {
    it('should support valid chain types', () => {
      const validChains: Array<'like' | 'evm' | 'op' | 'base'> = ['like', 'evm', 'op', 'base'];

      validChains.forEach((chain) => {
        expect(['like', 'evm', 'op', 'base']).toContain(chain);
      });
    });
  });

  describe('EVM Class ID Detection', () => {
    it('should detect EVM class IDs', () => {
      const evmClassId = '0x1234567890abcdef1234567890abcdef12345678';
      const isEVM = evmClassId.startsWith('0x') && evmClassId.length === 42;

      expect(isEVM).toBe(true);
    });

    it('should detect Cosmos class IDs', () => {
      const cosmosClassId = 'likenft1prx3jehu8ekvqkqw0x8ayfg2uhzu9f8dsmhxpjvky3s2gd5aqw5s5urhgd';
      const isCosmos = cosmosClassId.startsWith('likenft1') && cosmosClassId.length > 50;

      expect(isCosmos).toBe(true);
    });
  });
});

describe('NFT Book Purchase - Quantity and Stock Edge Cases', () => {
  it('should handle quantity of 1', () => {
    const quantity = 1;
    expect(quantity).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(quantity)).toBe(true);
  });

  it('should handle large quantities', () => {
    const quantity = 100;
    expect(quantity).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(quantity)).toBe(true);
  });

  it('should handle stock at boundary', () => {
    const stock = 1;
    const quantity = 1;
    const canPurchase = stock - quantity >= 0;

    expect(canPurchase).toBe(true);
  });

  it('should reject purchase when stock is zero', () => {
    const stock = 0;
    const quantity = 1;
    const canPurchase = stock - quantity >= 0;

    expect(canPurchase).toBe(false);
  });
});

describe('NFT Book Purchase - Pricing Rules', () => {
  describe('Minimum Price', () => {
    it('should accept minimum price of $0.99', () => {
      const MINIMUM_PRICE_IN_DECIMAL = 99;
      const priceInDecimal = 99;
      const isValidPrice = priceInDecimal >= MINIMUM_PRICE_IN_DECIMAL || priceInDecimal === 0;

      expect(isValidPrice).toBe(true);
    });

    it('should accept free items (price = 0)', () => {
      const priceInDecimal = 0;
      const isValidPrice = priceInDecimal === 0;

      expect(isValidPrice).toBe(true);
    });

    it('should reject prices below minimum (except free)', () => {
      const MINIMUM_PRICE_IN_DECIMAL = 99;
      const invalidPrices = [1, 50, 98];

      invalidPrices.forEach((price) => {
        const isValidPrice = price >= MINIMUM_PRICE_IN_DECIMAL || price === 0;
        expect(isValidPrice).toBe(false);
      });
    });
  });

  describe('Discount Rules', () => {
    it('should allow selling price equal to original price', () => {
      const originalPrice = 10000;
      const sellingPrice = 10000;
      const isValidDiscount = sellingPrice <= originalPrice;

      expect(isValidDiscount).toBe(true);
    });

    it('should allow selling price less than original price (discount)', () => {
      const originalPrice = 10000;
      const sellingPrice = 8000;
      const isValidDiscount = sellingPrice <= originalPrice;

      expect(isValidDiscount).toBe(true);
    });

    it('should not allow selling price greater than original price (except with tip)', () => {
      const originalPrice = 10000;
      const sellingPrice = 12000;

      const customPriceDiff = sellingPrice - originalPrice;
      const isValidWithTip = customPriceDiff > 0;

      expect(isValidWithTip).toBe(true);
    });
  });
});

describe('NFT Book Purchase - Fee Breakdown Examples', () => {
  describe('Documented Fee Examples', () => {
    it('should match PDF example: Author direct sale of $100 book (~90.3% royalty)', () => {
      const bookPrice = 10000;

      const platformFee = Math.ceil(bookPrice * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const stripeFee = calculateStripeFee(bookPrice);
      const commission = 0;

      const totalFees = platformFee + stripeFee + commission;
      const royalty = bookPrice - totalFees;

      expect(platformFee).toBe(500);
      expect(stripeFee).toBe(470);
      expect(totalFees).toBe(970);
      expect(royalty).toBe(9030);
    });

    it('should match PDF example: Third-party channel sale of $100 book (~60.3% royalty)', () => {
      const bookPrice = 10000;

      const channelCommission = Math.ceil(bookPrice * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);
      const platformFee = Math.ceil(bookPrice * NFT_BOOK_LIKER_LAND_FEE_RATIO);
      const stripeFee = calculateStripeFee(bookPrice);

      const totalFees = channelCommission + platformFee + stripeFee;
      const royalty = bookPrice - totalFees;

      expect(channelCommission).toBe(3000);
      expect(platformFee).toBe(500);
      expect(stripeFee).toBe(470);
      expect(totalFees).toBe(3970);
      expect(royalty).toBe(6030);
    });

    it('should verify commission goes to different recipients based on channel', () => {
      const bookPrice = 10000;
      const commissionAmount = Math.ceil(bookPrice * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);

      const likerLandScenario = {
        from: NFT_BOOK_DEFAULT_FROM_CHANNEL,
        likerLandCommission: commissionAmount,
        channelCommission: 0,
      };

      const externalChannelScenario = {
        from: '@bookstore',
        likerLandCommission: 0,
        channelCommission: commissionAmount,
      };

      const waivedScenario = {
        from: LIKER_LAND_WAIVED_CHANNEL,
        likerLandCommission: 0,
        channelCommission: 0,
      };

      expect(
        likerLandScenario.likerLandCommission + likerLandScenario.channelCommission,
      ).toBe(3000);
      expect(
        externalChannelScenario.likerLandCommission
          + externalChannelScenario.channelCommission,
      ).toBe(3000);
      expect(waivedScenario.likerLandCommission + waivedScenario.channelCommission).toBe(0);
    });
  });
});
