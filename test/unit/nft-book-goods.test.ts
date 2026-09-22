import {
  describe, it, expect, beforeEach, afterEach, vi, type MockInstance,
} from 'vitest';
import type Stripe from 'stripe';
import {
  isGoodsProduct,
  matchesProductTypeFilter,
  mergeNFTBookPriceUpdate,
} from '../../src/util/api/likernft/book';
import {
  assertOrderQuantityLimits,
  assertSingleProductTypeCart,
  getGoodsShippingFromSession,
  getIsEligibleForPlusPrice,
} from '../../src/util/api/likernft/book/cart';
import {
  filterBookPurchaseData,
  filterNFTBookListingInfo,
  filterNFTBookPricesInfo,
} from '../../src/util/ValidationHelper';
import {
  BookPurchaseDataFilteredSchema,
  NFTBookListingInfoFilteredSchema,
  NFTBookPriceFilteredSchema,
} from '../../src/util/api/likernft/book/schemas';
import { formatStripeCheckoutSession } from '../../src/util/api/likernft/book/purchase';
import { getStripeClient } from '../../src/util/stripe';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import type { NFTBookListingInfo, NFTBookPrice } from '../../src/types/book';

const GOODS_PRICE: NFTBookPrice = {
  name: { zh: '原價', en: 'List price' },
  description: { zh: '', en: '' },
  priceInDecimal: 25800,
  priceInDecimalByCurrency: { hkd: 199800 },
  plusPriceInDecimal: 21900,
  plusPriceInDecimalByCurrency: { hkd: 169800 },
  stock: 5,
  isAutoDeliver: false,
  stripeProductId: 'prod_1',
  stripePriceId: 'price_1',
  sold: 2,
  order: 0,
};

const goodsListing = (overrides: Partial<NFTBookListingInfo> = {}): NFTBookListingInfo => ({
  classId: '0x3a12abfd733cf5495526ad9246189b5dc699b552',
  ownerWallet: '0xstore',
  productType: 'goods',
  fulfilment: 'shipping',
  availableTerritories: ['HK'],
  name: 'Boox Go 7',
  nameByLocale: { en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' },
  pendingShipmentCount: 3,
  maxQuantityPerOrder: 1,
  prices: [GOODS_PRICE],
  ...overrides,
});

const cartItem = (overrides: Partial<CartItemWithInfo> = {}): CartItemWithInfo => ({
  classId: '0xclass',
  priceIndex: 0,
  quantity: 1,
  priceInDecimal: 1000,
  customPriceDiffInDecimal: 0,
  stock: 10,
  isAllowCustomPrice: false,
  name: 'Item',
  description: '',
  images: [],
  ownerWallet: '0xowner',
  isLikerLandArt: false,
  originalPriceInDecimal: 1000,
  chain: 'base',
  stripePriceId: 'price_test',
  ...overrides,
});

describe('product type helpers', () => {
  it('treats a listing with no productType as a book', () => {
    expect(isGoodsProduct({})).toBe(false);
    expect(matchesProductTypeFilter({}, 'book')).toBe(true);
    expect(matchesProductTypeFilter({}, 'goods')).toBe(false);
  });

  it('matches goods only when asked for goods or all', () => {
    const goods = { productType: 'goods' as const };
    expect(matchesProductTypeFilter(goods, 'book')).toBe(false);
    expect(matchesProductTypeFilter(goods, 'goods')).toBe(true);
    expect(matchesProductTypeFilter(goods, 'all')).toBe(true);
  });
});

describe('mergeNFTBookPriceUpdate', () => {
  const edit = {
    name: { zh: '新名', en: 'Renamed' },
    description: { zh: '', en: '' },
    priceInDecimal: 25800,
    priceInDecimalByCurrency: { hkd: 199800 },
    stock: 9,
  };

  it('keeps the member price when the edit omits it', () => {
    const merged = mergeNFTBookPriceUpdate(GOODS_PRICE, edit);
    expect(merged.plusPriceInDecimal).toBe(21900);
    expect(merged.plusPriceInDecimalByCurrency).toEqual({ hkd: 169800 });
    expect(merged.stock).toBe(9);
    // Fields the body cannot carry survive the merge.
    expect(merged.stripePriceId).toBe('price_1');
    expect(merged.sold).toBe(2);
  });

  it('clears the member price only on an explicit null', () => {
    const merged = mergeNFTBookPriceUpdate(GOODS_PRICE, {
      ...edit,
      plusPriceInDecimal: null,
      plusPriceInDecimalByCurrency: null,
    });
    expect(merged).not.toHaveProperty('plusPriceInDecimal');
    expect(merged).not.toHaveProperty('plusPriceInDecimalByCurrency');
  });

  it('replaces the member price when a new one is sent', () => {
    const merged = mergeNFTBookPriceUpdate(GOODS_PRICE, {
      ...edit,
      plusPriceInDecimal: 20000,
      plusPriceInDecimalByCurrency: { hkd: 159800 },
    });
    expect(merged.plusPriceInDecimal).toBe(20000);
    expect(merged.plusPriceInDecimalByCurrency).toEqual({ hkd: 159800 });
  });

  it('still clears an omitted list-price override', () => {
    const merged = mergeNFTBookPriceUpdate(GOODS_PRICE, {
      ...edit,
      priceInDecimalByCurrency: undefined,
    });
    expect(merged).not.toHaveProperty('priceInDecimalByCurrency');
  });
});

describe('response filters carry goods fields', () => {
  it('round-trips the member price through the price-level filter and schema', () => {
    const { prices: [price] } = filterNFTBookPricesInfo([GOODS_PRICE], false);
    const parsed = NFTBookPriceFilteredSchema.parse(price);
    expect(parsed.plusPriceInDecimal).toBe(21900);
    expect(parsed.plusPriceInDecimalByCurrency).toEqual({ hkd: 169800 });
  });

  it('omits the member price on a book edition that has none', () => {
    const { prices: [price] } = filterNFTBookPricesInfo([{ priceInDecimal: 500, stock: 1 }]);
    expect(price).not.toHaveProperty('plusPriceInDecimal');
  });

  it('exposes productType and territories publicly, the despatch count to the owner only', () => {
    const publicView = NFTBookListingInfoFilteredSchema.parse(
      filterNFTBookListingInfo(goodsListing(), false),
    );
    expect(publicView.productType).toBe('goods');
    expect(publicView.availableTerritories).toEqual(['HK']);
    expect(publicView.nameByLocale).toEqual({ en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' });
    expect(publicView.maxQuantityPerOrder).toBe(1);
    expect(publicView.pendingShipmentCount).toBeUndefined();

    const ownerView = NFTBookListingInfoFilteredSchema.parse(
      filterNFTBookListingInfo(goodsListing(), true),
    );
    expect(ownerView.pendingShipmentCount).toBe(3);
  });

  it('carries shipping fields on an order, with Stripe nulls in the address', () => {
    const filtered = filterBookPurchaseData({
      id: 'pay-1',
      status: 'shipped',
      phone: '+85291234567',
      shippingDetails: {
        name: 'Chan Tai Man',
        phone: '+85291234567',
        address: {
          line1: '1 Queen\'s Road',
          line2: null,
          city: 'Hong Kong',
          state: null,
          postal_code: null,
          country: 'HK',
        },
      },
      trackingNumber: '',
      shippedAt: { toMillis: () => 1700000000000 },
    });
    const parsed = BookPurchaseDataFilteredSchema.parse(filtered);
    expect(parsed.phone).toBe('+85291234567');
    expect(parsed.shippingDetails?.address?.country).toBe('HK');
    expect(parsed.trackingNumber).toBe('');
    expect(parsed.shippedAt).toBe(1700000000000);
  });
});

describe('assertSingleProductTypeCart', () => {
  const goods = (territories: string[]) => cartItem({
    productType: 'goods',
    availableTerritories: territories,
  });

  it('accepts a books-only cart, including legacy books with no productType', () => {
    expect(() => assertSingleProductTypeCart([
      cartItem(),
      cartItem({ productType: 'book' }),
    ])).not.toThrow();
  });

  it('rejects a cart mixing a book and a good', () => {
    expect(() => assertSingleProductTypeCart([cartItem(), goods(['HK'])]))
      .toThrow('CART_MIXED_PRODUCT_TYPE');
  });

  it('accepts goods sharing one territory set, in any order', () => {
    expect(() => assertSingleProductTypeCart([goods(['HK', 'TW']), goods(['TW', 'HK'])]))
      .not.toThrow();
  });

  it('rejects goods with different territory sets', () => {
    expect(() => assertSingleProductTypeCart([goods(['HK']), goods(['HK', 'TW'])]))
      .toThrow('CART_MIXED_TERRITORIES');
  });
});

describe('getIsEligibleForPlusPrice', () => {
  it.each([
    ['a yearly Plus member', { isLikerPlus: true, likerPlusPeriod: 'year', likerPlusTier: 'plus' }, true],
    ['a monthly Civic member', { isLikerPlus: true, likerPlusPeriod: 'month', likerPlusTier: 'civic' }, true],
    ['a monthly Plus member', { isLikerPlus: true, likerPlusPeriod: 'month', likerPlusTier: 'plus' }, false],
    ['a yearly trialist', {
      isLikerPlus: true, isLikerPlusTrial: true, likerPlusPeriod: 'year', likerPlusTier: 'plus',
    }, false],
    ['a Civic trialist', {
      isLikerPlus: true, isLikerPlusTrial: true, likerPlusPeriod: 'year', likerPlusTier: 'civic',
    }, false],
    ['a lapsed member', { isLikerPlus: false, likerPlusPeriod: 'year' }, false],
    ['a guest', null, false],
  ])('%s → %s', (_, user, expected) => {
    expect(getIsEligibleForPlusPrice(user)).toBe(expected);
  });
});

describe('getGoodsShippingFromSession', () => {
  it('reads shipping from collected_information and phone from customer_details', () => {
    const session = {
      collected_information: {
        shipping_details: {
          name: 'Chan Tai Man',
          address: {
            line1: '1 Queen\'s Road',
            line2: null,
            city: 'Hong Kong',
            state: null,
            postal_code: null,
            country: 'HK',
          },
        },
      },
      customer_details: { phone: '+85291234567' },
    } as unknown as Stripe.Checkout.Session;
    expect(getGoodsShippingFromSession(session)).toEqual({
      phone: '+85291234567',
      shippingDetails: {
        name: 'Chan Tai Man',
        phone: '+85291234567',
        address: {
          line1: '1 Queen\'s Road',
          line2: null,
          city: 'Hong Kong',
          state: null,
          postal_code: null,
          country: 'HK',
        },
      },
    });
  });

  it('writes no keys for a book session, since Firestore rejects undefined', () => {
    const session = {
      collected_information: null,
      customer_details: { phone: null },
    } as unknown as Stripe.Checkout.Session;
    expect(getGoodsShippingFromSession(session)).toEqual({});
    expect(getGoodsShippingFromSession(undefined)).toEqual({});
  });
});

describe('assertOrderQuantityLimits', () => {
  it('allows an order up to the cap and ignores items without one', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xgoods', quantity: 1, maxQuantityPerOrder: 1 }),
      cartItem({ classId: '0xbook', quantity: 5 }),
    ])).not.toThrow();
  });

  it('rejects a quantity over the cap', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xgoods', quantity: 2, maxQuantityPerOrder: 1 }),
    ])).toThrow('QUANTITY_EXCEEDS_ORDER_LIMIT');
  });

  it('sums a class listed twice, so the cap cannot be split across lines', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xgoods', quantity: 1, maxQuantityPerOrder: 1 }),
      cartItem({ classId: '0xgoods', quantity: 1, maxQuantityPerOrder: 1 }),
    ])).toThrow('QUANTITY_EXCEEDS_ORDER_LIMIT');
  });
});

describe('formatStripeCheckoutSession for goods', () => {
  let createSpy: MockInstance;
  beforeEach(() => {
    createSpy = vi.spyOn(getStripeClient().checkout.sessions, 'create')
      .mockResolvedValue({ id: 'cs_test', url: 'https://checkout.example/cs_test' } as any);
  });
  afterEach(() => {
    createSpy.mockRestore();
  });

  const urls = { successUrl: 'https://3ook.com/ok', cancelUrl: 'https://3ook.com/cancel' };

  it('collects a shipping address, disables discounts and requests an invoice', async () => {
    const memberPriced = cartItem({
      productType: 'goods',
      priceInDecimal: 21900,
      originalPriceInDecimal: 25800,
      priceInDecimalByCurrency: { hkd: 169800 },
      stripePriceId: undefined,
      isPlusPrice: true,
    });
    await formatStripeCheckoutSession({
      paymentId: 'pay-1',
      claimToken: 'token',
      currency: 'hkd',
      coupon: 'CAMPAIGN',
    }, [memberPriced], {
      ...urls,
      shippingCountries: ['HK'],
      allowDiscounts: false,
      createInvoice: true,
    });
    const payload = createSpy.mock.calls[0][0];
    expect(payload.shipping_address_collection).toEqual({ allowed_countries: ['HK'] });
    expect(payload.phone_number_collection).toEqual({ enabled: true });
    expect(payload.allow_promotion_codes).toBeUndefined();
    expect(payload.discounts).toBeUndefined();
    expect(payload.invoice_creation).toEqual({ enabled: true });
    // The member price is charged in its own override, with the edition kept for the webhook.
    const [line] = payload.line_items;
    expect(line.price_data.unit_amount).toBe(169800);
    expect(line.price_data.product_data.metadata.priceIndex).toBe('0');
  });

  it('leaves a book session as before', async () => {
    await formatStripeCheckoutSession({
      paymentId: 'pay-2',
      claimToken: 'token',
    }, [cartItem()], urls);
    const payload = createSpy.mock.calls[0][0];
    expect(payload.shipping_address_collection).toBeUndefined();
    expect(payload.invoice_creation).toBeUndefined();
    expect(payload.allow_promotion_codes).toBe(true);
    expect(payload.line_items[0].price).toBe('price_test');
  });
});
