import {
  describe, it, expect, beforeEach, afterEach, vi, type MockInstance,
} from 'vitest';
import type Stripe from 'stripe';
import {
  isNonNFTProduct,
  isShippedProduct,
  matchesProductTypeFilter,
  mergeNFTBookPriceUpdate,
} from '../../src/util/api/likernft/book';
import {
  assertOrderQuantityLimits,
  assertSingleProductTypeCart,
  formatCartItemsWithInfo,
  getMerchShippingFromSession,
  getIsEligibleForPlusPrice,
  processNFTBookCartStripePurchase,
} from '../../src/util/api/likernft/book/cart';
import { likeNFTBookCartCollection, likeNFTBookCollection } from '../../src/util/firebase';
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

const MERCH_PRICE: NFTBookPrice = {
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

const merchListing = (overrides: Partial<NFTBookListingInfo> = {}): NFTBookListingInfo => ({
  classId: '0x3a12abfd733cf5495526ad9246189b5dc699b552',
  ownerWallet: '0xstore',
  productType: 'merch',
  availableTerritories: ['HK'],
  name: 'Boox Go 7',
  nameByLocale: { en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' },
  pendingShipmentCount: 3,
  maxQuantityPerOrder: 1,
  prices: [MERCH_PRICE],
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
    expect(isNonNFTProduct({})).toBe(false);
    expect(matchesProductTypeFilter({}, 'book')).toBe(true);
    expect(matchesProductTypeFilter({}, 'merch')).toBe(false);
  });

  it('treats merch as both non-NFT and shipped, and a book as neither', () => {
    expect(isNonNFTProduct({ productType: 'merch' })).toBe(true);
    expect(isShippedProduct({ productType: 'merch' })).toBe(true);
    expect(isShippedProduct({ productType: 'book' })).toBe(false);
    expect(isShippedProduct({})).toBe(false);
  });

  it('matches merch only when asked for merch or all', () => {
    const merch = { productType: 'merch' as const };
    expect(matchesProductTypeFilter(merch, 'book')).toBe(false);
    expect(matchesProductTypeFilter(merch, 'merch')).toBe(true);
    expect(matchesProductTypeFilter(merch, 'all')).toBe(true);
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
    const merged = mergeNFTBookPriceUpdate(MERCH_PRICE, edit);
    expect(merged.plusPriceInDecimal).toBe(21900);
    expect(merged.plusPriceInDecimalByCurrency).toEqual({ hkd: 169800 });
    expect(merged.stock).toBe(9);
    // Fields the body cannot carry survive the merge.
    expect(merged.stripePriceId).toBe('price_1');
    expect(merged.sold).toBe(2);
  });

  it('clears the member price only on an explicit null', () => {
    const merged = mergeNFTBookPriceUpdate(MERCH_PRICE, {
      ...edit,
      plusPriceInDecimal: null,
      plusPriceInDecimalByCurrency: null,
    });
    expect(merged).not.toHaveProperty('plusPriceInDecimal');
    expect(merged).not.toHaveProperty('plusPriceInDecimalByCurrency');
  });

  it('replaces the member price when a new one is sent', () => {
    const merged = mergeNFTBookPriceUpdate(MERCH_PRICE, {
      ...edit,
      plusPriceInDecimal: 20000,
      plusPriceInDecimalByCurrency: { hkd: 159800 },
    });
    expect(merged.plusPriceInDecimal).toBe(20000);
    expect(merged.plusPriceInDecimalByCurrency).toEqual({ hkd: 159800 });
  });

  it('still clears an omitted list-price override', () => {
    const merged = mergeNFTBookPriceUpdate(MERCH_PRICE, {
      ...edit,
      priceInDecimalByCurrency: undefined,
    });
    expect(merged).not.toHaveProperty('priceInDecimalByCurrency');
  });
});

describe('response filters carry merch fields', () => {
  it('round-trips the member price through the price-level filter and schema', () => {
    const { prices: [price] } = filterNFTBookPricesInfo([MERCH_PRICE], false);
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
      filterNFTBookListingInfo(merchListing(), false),
    );
    expect(publicView.productType).toBe('merch');
    expect(publicView.availableTerritories).toEqual(['HK']);
    expect(publicView.nameByLocale).toEqual({ en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' });
    expect(publicView.maxQuantityPerOrder).toBe(1);
    expect(publicView.pendingShipmentCount).toBeUndefined();

    const ownerView = NFTBookListingInfoFilteredSchema.parse(
      filterNFTBookListingInfo(merchListing(), true),
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
  const merch = (territories: string[]) => cartItem({
    productType: 'merch',
    availableTerritories: territories,
  });

  it('accepts a books-only cart, including legacy books with no productType', () => {
    expect(() => assertSingleProductTypeCart([
      cartItem(),
      cartItem({ productType: 'book' }),
    ])).not.toThrow();
  });

  it('rejects a cart mixing a book and merch', () => {
    expect(() => assertSingleProductTypeCart([cartItem(), merch(['HK'])]))
      .toThrow('CART_MIXED_PRODUCT_TYPE');
  });

  it('accepts merch sharing one territory set, in any order', () => {
    expect(() => assertSingleProductTypeCart([merch(['HK', 'TW']), merch(['TW', 'HK'])]))
      .not.toThrow();
  });

  it('rejects merch with different territory sets', () => {
    expect(() => assertSingleProductTypeCart([merch(['HK']), merch(['HK', 'TW'])]))
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

describe('getMerchShippingFromSession', () => {
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
    expect(getMerchShippingFromSession(session)).toEqual({
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
    expect(getMerchShippingFromSession(session)).toEqual({});
    expect(getMerchShippingFromSession(undefined)).toEqual({});
  });
});

describe('assertOrderQuantityLimits', () => {
  it('allows an order up to the cap and ignores items without one', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xmerch', quantity: 1, maxQuantityPerOrder: 1 }),
      cartItem({ classId: '0xbook', quantity: 5 }),
    ])).not.toThrow();
  });

  it('rejects a quantity over the cap', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xmerch', quantity: 2, maxQuantityPerOrder: 1 }),
    ])).toThrow('QUANTITY_EXCEEDS_ORDER_LIMIT');
  });

  it('sums a class listed twice, so the cap cannot be split across lines', () => {
    expect(() => assertOrderQuantityLimits([
      cartItem({ classId: '0xmerch', quantity: 1, maxQuantityPerOrder: 1 }),
      cartItem({ classId: '0xmerch', quantity: 1, maxQuantityPerOrder: 1 }),
    ])).toThrow('QUANTITY_EXCEEDS_ORDER_LIMIT');
  });
});

describe('formatStripeCheckoutSession for merch', () => {
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
      productType: 'merch',
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

describe('formatCartItemsWithInfo for merch', () => {
  // Not EVM-shaped, so a chain read would go to the Cosmos query.
  const SKU_ID = 'merch-sku-1';

  it('builds the item from the listing without a chain class', async () => {
    await likeNFTBookCollection.doc(SKU_ID).set(merchListing({ classId: SKU_ID }));
    const [item] = await formatCartItemsWithInfo([{ classId: SKU_ID, priceIndex: 0 }]);
    expect(item.name).toContain('Boox Go 7');
    expect(item.productType).toBe('merch');
  });
});

describe('processNFTBookCartStripePurchase retries', () => {
  let retrieveSpy: MockInstance;
  beforeEach(() => {
    retrieveSpy = vi.spyOn(getStripeClient().paymentIntents, 'retrieve')
      .mockRejectedValue(new Error('STOP'));
  });
  afterEach(() => {
    retrieveSpy.mockRestore();
  });

  const session = (cartId: string) => ({
    id: 'cs_retry',
    amount_total: 1000,
    payment_intent: 'pi_retry',
    customer_details: { email: 'buyer@example.com' },
    metadata: { cartId },
  }) as unknown as Stripe.Checkout.Session;

  it.each(['paid', 'processing', 'completed'])('skips a cart already %s', async (status) => {
    const cartId = `cart-${status}`;
    await likeNFTBookCartCollection.doc(cartId).set({ status });
    await expect(processNFTBookCartStripePurchase(session(cartId), {} as any))
      .resolves.toBeUndefined();
    expect(retrieveSpy).not.toHaveBeenCalled();
  });

  it('still processes a new cart', async () => {
    await likeNFTBookCartCollection.doc('cart-new').set({ status: 'new' });
    await expect(processNFTBookCartStripePurchase(session('cart-new'), {} as any))
      .rejects.toThrow('STOP');
    expect(retrieveSpy).toHaveBeenCalled();
  });
});
