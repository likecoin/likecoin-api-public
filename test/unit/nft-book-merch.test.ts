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
  assertNoDuplicateClassIds,
  assertOrderQuantityLimits,
  assertSingleProductTypeCart,
  formatCartItemInfosFromSession,
  formatCartItemsWithInfo,
  getMerchShippingFromSession,
  getIsEligibleForPlusPrice,
  getPlusPromoNamesByPeriod,
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
  NewListingBodySchema,
  NFTBookListingInfoFilteredSchema,
  NFTBookPriceFilteredSchema,
} from '../../src/util/api/likernft/book/schemas';
import { formatStripeCheckoutSession } from '../../src/util/api/likernft/book/purchase';
import { calculateItemPrices } from '../../src/util/api/likernft/book/price';
import { calculateItemFeeInfo } from '../../src/util/api/likernft/book/payment';
import { calculateStripeFee, getStripeClient } from '../../src/util/stripe';
import { LIKER_LAND_WAIVED_CHANNEL, NFT_BOOK_DEFAULT_FROM_CHANNEL } from '../../src/constant';
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

describe('NewListingBodySchema availableTerritories', () => {
  const body = (availableTerritories: string[]) => ({
    prices: [MERCH_PRICE],
    productType: 'merch',
    availableTerritories,
  });

  it('accepts codes Stripe ships to, including its non-ISO destinations', () => {
    expect(NewListingBodySchema.safeParse(body(['HK', 'TW', 'XK'])).success).toBe(true);
  });

  it.each([
    ['a well-formed code Stripe rejects', 'CU'],
    ['an unknown code', 'ZZ'],
    ['a lower-case code', 'hk'],
  ])('rejects %s', (_, code) => {
    const result = NewListingBodySchema.safeParse(body([code]));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('INVALID_TERRITORY_CODE');
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
      filterNFTBookListingInfo(merchListing({
        platformCommissionRatio: 0.3148,
        channelCommissionRatio: 0.1,
      }), false),
    );
    expect(publicView.productType).toBe('merch');
    expect(publicView.availableTerritories).toEqual(['HK']);
    expect(publicView.nameByLocale).toEqual({ en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' });
    expect(publicView.maxQuantityPerOrder).toBe(1);
    expect(publicView.pendingShipmentCount).toBeUndefined();
    expect(publicView).not.toHaveProperty('platformCommissionRatio');
    expect(publicView).not.toHaveProperty('channelCommissionRatio');

    const publicBookView = filterNFTBookListingInfo({
      classId: '0xbook',
      ownerWallet: '0xowner',
      platformCommissionRatio: 0.1,
      channelCommissionRatio: 0.2,
    }, false);
    expect(publicBookView).not.toHaveProperty('platformCommissionRatio');
    expect(publicBookView).not.toHaveProperty('channelCommissionRatio');

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

describe('getPlusPromoNamesByPeriod', () => {
  it('routes a yearly promo to the gift cart and everything else to the coupon', () => {
    const items = [
      { listingData: merchListing({ plusPromoEnabled: true, plusPromoPeriod: 'year' }) },
      { listingData: merchListing({ plusPromoEnabled: true }) },
      { listingData: merchListing({ plusPromoEnabled: true, plusPromoPeriod: 'month' }) },
      { listingData: merchListing({ plusPromoPeriod: 'year' }) },
      { listingData: undefined },
    ];
    expect(getPlusPromoNamesByPeriod(items, ['reader', 'a', 'b', 'off', 'none'])).toEqual({
      year: ['reader'],
      month: ['a', 'b'],
    });
  });

  it('round-trips plusPromoPeriod through the public listing filter', () => {
    const listing = merchListing({ plusPromoEnabled: true, plusPromoPeriod: 'year' });
    const filtered = filterNFTBookListingInfo(listing, false);
    expect(filtered.plusPromoPeriod).toBe('year');
    expect(NFTBookListingInfoFilteredSchema.safeParse(filtered).success).toBe(true);
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
});

describe('assertNoDuplicateClassIds', () => {
  it('allows distinct classes', () => {
    expect(() => assertNoDuplicateClassIds([
      cartItem({ classId: '0xmerch', quantity: 1 }),
      cartItem({ classId: '0xbook', quantity: 1 }),
    ])).not.toThrow();
  });

  it('rejects a class listed twice', () => {
    expect(() => assertNoDuplicateClassIds([
      cartItem({ classId: '0xmerch', quantity: 1 }),
      cartItem({ classId: '0xmerch', quantity: 1 }),
    ])).toThrow('CART_DUPLICATE_CLASS_ID');
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
    expect(line.price_data.product_data.metadata.isPlusPrice).toBe('true');
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

describe('calculateItemPrices for merch', () => {
  const AFFILIATE = '@affiliate';
  const merchItem = (overrides: Partial<CartItemWithInfo> = {}) => cartItem({
    productType: 'merch',
    priceInDecimal: 247800,
    originalPriceInDecimal: 247800,
    ...overrides,
  });
  const pricesFor = (item: CartItemWithInfo, from: string) => calculateItemPrices([item], from)[0];

  it.each([NFT_BOOK_DEFAULT_FROM_CHANNEL, AFFILIATE])('takes no commission without ratios (from %s)', (from) => {
    const item = merchItem({ priceInDecimal: 25800, originalPriceInDecimal: 25800 });
    const itemPrice = pricesFor(item, from);
    expect(itemPrice.likerLandCommission).toBe(0);
    expect(itemPrice.channelCommission).toBe(0);

    const stripeFeeAmount = calculateStripeFee(25800, 'usd');
    const { royaltyToSplit } = calculateItemFeeInfo(itemPrice, {
      totalStripeFeeAmount: stripeFeeAmount,
      totalPriceInDecimal: 25800,
    });
    expect(royaltyToSplit).toBe(25800 - Math.ceil(25800 * 0.05) - stripeFeeAmount);
  });

  it.each([NFT_BOOK_DEFAULT_FROM_CHANNEL, AFFILIATE])('keeps the platform ratio and pays no affiliate (from %s)', (from) => {
    const itemPrice = pricesFor(merchItem({ platformCommissionRatio: 0.3148 }), from);
    expect(itemPrice.likerLandCommission).toBe(78008);
    expect(itemPrice.channelCommission).toBe(0);
  });

  it('pays the channel ratio on top only to an affiliate', () => {
    const item = merchItem({ platformCommissionRatio: 0.3148, channelCommissionRatio: 0.1 });
    expect(pricesFor(item, AFFILIATE)).toMatchObject({
      likerLandCommission: 78008,
      channelCommission: 24780,
    });
    expect(pricesFor(item, NFT_BOOK_DEFAULT_FROM_CHANNEL)).toMatchObject({
      likerLandCommission: 78008,
      channelCommission: 0,
    });
  });

  it('waives both ratios for liker_land_waived', () => {
    const item = merchItem({ platformCommissionRatio: 0.3148, channelCommissionRatio: 0.1 });
    expect(pricesFor(item, LIKER_LAND_WAIVED_CHANNEL)).toMatchObject({
      likerLandCommission: 0,
      channelCommission: 0,
    });
  });

  it('follows the item channel over the cart channel', () => {
    const item = merchItem({ platformCommissionRatio: 0.3148, channelCommissionRatio: 0.1 });
    expect(pricesFor({ ...item, from: LIKER_LAND_WAIVED_CHANNEL }, AFFILIATE)).toMatchObject({
      likerLandCommission: 0,
      channelCommission: 0,
    });
    expect(pricesFor({ ...item, from: AFFILIATE }, LIKER_LAND_WAIVED_CHANNEL)).toMatchObject({
      likerLandCommission: 78008,
      channelCommission: 24780,
    });
  });

  it('takes the ratios on the price paid, excluding the tip', () => {
    const item = merchItem({
      platformCommissionRatio: 0.2,
      channelCommissionRatio: 0.1,
      priceInDecimal: 21900 + 1000,
      customPriceDiffInDecimal: 1000,
      originalPriceInDecimal: 25800,
      isPlusPrice: true,
    });
    expect(pricesFor(item, AFFILIATE)).toMatchObject({
      likerLandCommission: 4380,
      channelCommission: 2190,
      likerLandFeeAmount: 0,
    });
  });

  it('waives the platform fee on a member price, leaving the owner the price paid less Stripe', () => {
    const item = merchItem({
      priceInDecimal: 21900, originalPriceInDecimal: 25800, isPlusPrice: true,
    });
    const itemPrice = pricesFor(item, NFT_BOOK_DEFAULT_FROM_CHANNEL);
    expect(itemPrice).toMatchObject({
      likerLandFeeAmount: 0,
      likerLandCommission: 0,
      channelCommission: 0,
    });

    const stripeFeeAmount = calculateStripeFee(21900, 'usd');
    const feeInfo = calculateItemFeeInfo(itemPrice, {
      totalStripeFeeAmount: stripeFeeAmount,
      totalPriceInDecimal: 21900,
    });
    expect(feeInfo.likerLandFeeAmount).toBe(0);
    expect(feeInfo.royaltyToSplit).toBe(21900 - stripeFeeAmount);
  });

  it('charges the platform fee at list price, even when FX conversion lands below it', () => {
    const item = merchItem({ priceInDecimal: 25800, originalPriceInDecimal: 25800 });
    expect(pricesFor(item, NFT_BOOK_DEFAULT_FROM_CHANNEL).likerLandFeeAmount).toBe(1290);
    // HKD 1,998 settled at 7.8 HKD/USD
    const converted = merchItem({ priceInDecimal: 25615, originalPriceInDecimal: 25800 });
    expect(pricesFor(converted, NFT_BOOK_DEFAULT_FROM_CHANNEL).likerLandFeeAmount).toBe(1290);
  });

  it('waives the platform fee but keeps the platform ratio on a discounted bundle', () => {
    const item = merchItem({
      platformCommissionRatio: 0.3148, priceInDecimal: 200000, isPlusPrice: true,
    });
    expect(pricesFor(item, AFFILIATE)).toMatchObject({
      likerLandFeeAmount: 0,
      likerLandCommission: 62960,
      channelCommission: 0,
    });
  });

  it('keeps the platform fee on a discounted book', () => {
    const book = cartItem({ priceInDecimal: 8000, originalPriceInDecimal: 10000 });
    expect(pricesFor(book, NFT_BOOK_DEFAULT_FROM_CHANNEL).likerLandFeeAmount).toBe(500);
  });

  it('does not round a whole-cent commission up on float error', () => {
    const item = merchItem({ platformCommissionRatio: 0.3148, priceInDecimal: 200000 });
    expect(pricesFor(item, NFT_BOOK_DEFAULT_FROM_CHANNEL).likerLandCommission).toBe(62960);
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

  it('carries the commission ratios onto the cart item', async () => {
    await likeNFTBookCollection.doc(SKU_ID).set(merchListing({
      classId: SKU_ID,
      platformCommissionRatio: 0.3148,
      channelCommissionRatio: 0.1,
    }));
    const [item] = await formatCartItemsWithInfo([{ classId: SKU_ID, priceIndex: 0 }]);
    expect(item.platformCommissionRatio).toBe(0.3148);
    expect(item.channelCommissionRatio).toBe(0.1);
  });

  it('rejects the same SKU on two cart lines', async () => {
    await likeNFTBookCollection.doc(SKU_ID).set(merchListing({ classId: SKU_ID }));
    await expect(formatCartItemsWithInfo([
      { classId: SKU_ID, priceIndex: 0, quantity: 1 },
      { classId: SKU_ID, priceIndex: 0, quantity: 1 },
    ])).rejects.toThrow('CART_DUPLICATE_CLASS_ID');
  });
});

describe('formatCartItemInfosFromSession for merch', () => {
  const SKU_ID = 'merch-sku-1';
  let spies: MockInstance[] = [];
  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore());
    spies = [];
  });

  async function settle(productMetadata: Record<string, string>) {
    await likeNFTBookCollection.doc(SKU_ID).set(merchListing({ classId: SKU_ID }));
    const stripe = getStripeClient();
    spies = [
      vi.spyOn(stripe.checkout.sessions, 'listLineItems').mockReturnValue([{
        quantity: 1,
        amount_total: 21900,
        price: { product: { metadata: { classId: SKU_ID, priceIndex: '0', ...productMetadata } } },
      }] as any),
      vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({} as any),
    ];
    return formatCartItemInfosFromSession({ id: 'cs_merch', metadata: { from: 'liker_land' } } as any);
  }

  it('waives the platform fee only on a line the session marks member-priced', async () => {
    const memberPriced = await settle({ isPlusPrice: 'true' });
    expect(memberPriced.itemInfos[0].isPlusPrice).toBe(true);
    expect(memberPriced.feeInfo.likerLandFeeAmount).toBe(0);

    const listPriced = await settle({});
    expect(listPriced.itemInfos[0].isPlusPrice).toBe(false);
    expect(listPriced.feeInfo.likerLandFeeAmount).toBe(1290);
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
