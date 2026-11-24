import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type Stripe from 'stripe';

const { mockCreate, mockFirstPage } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFirstPage: vi.fn(),
}));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return (tableId: string) => ({
        create: (...args: unknown[]) => mockCreate(tableId, ...args),
        select: () => ({ firstPage: () => mockFirstPage(tableId) }),
      });
    }
  },
}));

// The Airtable base is only initialized outside test mode.
vi.mock('../../src/constant', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  TEST_MODE: false,
}));
vi.stubEnv('CI', '');

// eslint-disable-next-line import/first
const {
  createAirtableBookSalesRecordFromFreePurchase,
  createAirtableBookSalesRecordFromStripePaymentIntent,
} = await import('../../src/util/airtable');
// eslint-disable-next-line import/first
const { getAirtableMerchSalesInfo } = await import('../../src/util/api/likernft/book/cart');

const BOOK_SALES_TABLE_ID = 'tblrSSj45M6frGRdM';
const MERCH_SALES_TABLE_ID = 'tblxdambGNlYsrFOv';
const PUBLICATION_RECORD_ID = 'recPublication';

const FEE_INFO = {
  priceInDecimal: 25800,
  originalPriceInDecimal: 25800,
  stripeFeeAmount: 0,
  likerLandTipFeeAmount: 0,
  likerLandFeeAmount: 0,
  likerLandCommission: 0,
  channelCommission: 0,
  likerLandArtFee: 0,
  customPriceDiffInDecimal: 0,
  royaltyToSplit: 25800,
};

const PI = {
  id: 'pi_1',
  amount: 25800,
  currency: 'usd',
  created: 1764000000,
  metadata: {},
  latest_charge: null,
} as unknown as Stripe.PaymentIntent;

const SESSION = {
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
  shipping_cost: { amount_total: 3000 },
} as unknown as Stripe.Checkout.Session;

const MERCH = {
  productName: 'Boox Go 7 電子閱讀器',
  isPlusPrice: true,
  shippingCountry: 'HK',
  shippingCost: 30,
  customerName: 'Chan Tai Man',
  customerPhone: '+85291234567',
};

const MERCH_FIELDS = [
  'Product ID',
  'Product Name',
  'Is Member Price',
  'Shipping Country',
  'Shipping Cost',
  'Customer Name',
  'Customer Phone',
];

function stripeRecord(classId: string, merch?: typeof MERCH) {
  return createAirtableBookSalesRecordFromStripePaymentIntent({
    pi: PI,
    paymentId: 'payment-1',
    classId,
    priceIndex: 0,
    transfers: [],
    feeInfo: FEE_INFO,
    stripeFeeAmount: 0,
    stripeFeeCurrency: 'USD',
    cartId: 'cart-1',
    isGift: false,
    merch,
  });
}

function freeRecord(classId: string, merch?: typeof MERCH) {
  return createAirtableBookSalesRecordFromFreePurchase({
    classId,
    priceIndex: 0,
    paymentId: 'payment-1',
    utmSource: undefined,
    utmCampaign: undefined,
    utmMedium: undefined,
    referrer: undefined,
    gaClientId: undefined,
    gaSessionId: undefined,
    cartId: 'cart-1',
    merch,
  });
}

function createdRecords() {
  return mockCreate.mock.calls.map(([tableId, [{ fields }]]) => ({ tableId, fields }));
}

describe('Airtable sales records by product type', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFirstPage.mockReset();
    mockFirstPage.mockResolvedValue([{ id: PUBLICATION_RECORD_ID }]);
  });

  it.each([
    ['Stripe', stripeRecord],
    ['free', freeRecord],
  ])('writes a %s merch sale to Sales (Merch) without a Product link', async (_, write) => {
    await write('0xmerch', MERCH);
    const [{ tableId, fields }] = createdRecords();
    expect(tableId).toBe(MERCH_SALES_TABLE_ID);
    expect(fields).toMatchObject({
      'Payment ID': 'payment-1',
      'Product ID': '0xmerch',
      'Product Name': 'Boox Go 7 電子閱讀器',
      'Is Member Price': true,
      'Shipping Country': 'HK',
      'Shipping Cost': 30,
      'Customer Name': 'Chan Tai Man',
      'Customer Phone': '+85291234567',
      'Cart ID': 'cart-1',
    });
    expect(fields).not.toHaveProperty('Product');
    expect(mockFirstPage).not.toHaveBeenCalled();
  });

  it.each([
    ['Stripe', stripeRecord],
    ['free', freeRecord],
  ])('keeps writing a %s book sale to Sales (Book)', async (_, write) => {
    await write('0xbook');
    const [{ tableId, fields }] = createdRecords();
    expect(tableId).toBe(BOOK_SALES_TABLE_ID);
    expect(fields.Product).toEqual([PUBLICATION_RECORD_ID]);
    MERCH_FIELDS.forEach((field) => expect(fields).not.toHaveProperty(field));
  });

  it('splits a cart of a book and merch across both tables', async () => {
    const items = [
      { classId: '0xbook', listingData: {} },
      { classId: '0xmerch', listingData: { productType: 'merch' as const } },
    ];
    const firstMerchItemIndex = 1;
    await Promise.all(items.map(({ classId, listingData }, itemIndex) => stripeRecord(
      classId,
      getAirtableMerchSalesInfo({
        listingData,
        name: classId,
        session: SESSION,
        hasShippingCost: itemIndex === firstMerchItemIndex,
      }),
    )));
    const records = createdRecords();
    expect(records).toHaveLength(2);
    const book = records.find(({ tableId }) => tableId === BOOK_SALES_TABLE_ID);
    const merch = records.find(({ tableId }) => tableId === MERCH_SALES_TABLE_ID);
    expect(book?.fields.Product).toEqual([PUBLICATION_RECORD_ID]);
    MERCH_FIELDS.forEach((field) => expect(book?.fields).not.toHaveProperty(field));
    expect(merch?.fields).not.toHaveProperty('Product');
    expect(merch?.fields).toMatchObject({
      'Product ID': '0xmerch',
      'Shipping Country': 'HK',
      'Shipping Cost': 30,
      'Customer Name': 'Chan Tai Man',
      'Customer Phone': '+85291234567',
    });
  });
});

describe('getAirtableMerchSalesInfo', () => {
  it('returns nothing for a book', () => {
    expect(getAirtableMerchSalesInfo({
      listingData: {},
      name: 'Book',
      session: SESSION,
      hasShippingCost: true,
    })).toBeUndefined();
  });

  it('leaves the shipping cost to the first merch row of the session', () => {
    const info = (hasShippingCost: boolean) => getAirtableMerchSalesInfo({
      listingData: { productType: 'merch' },
      name: 'Boox Go 7',
      isPlusPrice: false,
      session: SESSION,
      hasShippingCost,
    });
    expect(info(true)?.shippingCost).toBe(30);
    expect(info(false)?.shippingCost).toBeUndefined();
    expect(info(false)).toMatchObject({
      productName: 'Boox Go 7',
      isPlusPrice: false,
      shippingCountry: 'HK',
      customerName: 'Chan Tai Man',
      customerPhone: '+85291234567',
    });
  });

  it('names the product in Chinese first', () => {
    expect(getAirtableMerchSalesInfo({
      listingData: {
        productType: 'merch',
        nameByLocale: { en: 'Boox Go 7', zh: 'Boox Go 7 電子閱讀器' },
      },
      name: 'Boox Go 7',
      hasShippingCost: false,
    })?.productName).toBe('Boox Go 7 電子閱讀器');
  });

  it('omits buyer details a session did not collect', () => {
    expect(getAirtableMerchSalesInfo({
      listingData: { productType: 'merch' },
      name: 'Boox Go 7',
      hasShippingCost: true,
    })).toEqual({
      productName: 'Boox Go 7',
      isPlusPrice: undefined,
      shippingCountry: undefined,
      shippingCost: undefined,
      customerName: undefined,
      customerPhone: undefined,
    });
  });
});
