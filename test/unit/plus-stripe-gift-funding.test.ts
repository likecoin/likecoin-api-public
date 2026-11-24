import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { FieldValue, likePlusGiftCartCollection, userCollection } from '../../src/util/firebase';
import type { LikerPlusData } from '../../src/types/user';

const {
  mockSubscriptionRetrieve,
  mockSessionRetrieve,
  mockRecordAccrual,
} = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
  mockSessionRetrieve: vi.fn(),
  mockRecordAccrual: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getStripeClient: () => ({
    subscriptions: { retrieve: mockSubscriptionRetrieve },
    checkout: { sessions: { retrieve: mockSessionRetrieve } },
    // Unimplemented on purpose: the invoice lookups are best-effort and swallow errors.
    invoices: {},
    paymentIntents: {},
  }),
}));
vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  createAirtableSubscriptionPaymentRecord: vi.fn(),
  updateAirtablePlusGiftSalesRecord: vi.fn(),
}));
vi.mock('../../src/util/slack', async (importOriginal) => ({
  ...(await importOriginal() as object),
  sendPlusSubscriptionSlackNotification: vi.fn(),
}));
vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn() }));
vi.mock('../../src/util/api/plus/airdrop', () => ({ payPlusSubscriptionAirdrop: vi.fn() }));
vi.mock('../../src/util/api/plus/revenueShare', async (importOriginal) => ({
  ...(await importOriginal() as object),
  recordPlusSubscriptionAccrual: mockRecordAccrual,
}));

// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

(config as Record<string, unknown>).LIKER_PLUS_PRODUCT_ID = 'prod_plus';
(config as Record<string, unknown>).LIKER_PLUS_CIVIC_PRODUCT_ID = 'prod_civic';

// eslint-disable-next-line import/first
const { processStripeSubscriptionInvoice } = await import('../../src/util/api/plus');
// eslint-disable-next-line import/first
const { writePlusGiftClaimRecord } = await import('../../src/util/api/plus/gift');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_gift_funding';
const START_DATE = 1747000000;
const YEAR = 365 * 24 * 60 * 60;
const GIFT_CART_ID = 'cart_gift_funding';
const GIFT_METADATA = { isGift: 'true', giftCartId: GIFT_CART_ID };

const req = { headers: {} };
let invoiceSeq = 0;

function seedSubscription({
  status = 'trialing',
  periodStart = START_DATE,
  metadata = GIFT_METADATA as Record<string, string>,
  productId = 'prod_plus',
} = {}) {
  mockSubscriptionRetrieve.mockResolvedValue({
    id: SUB_ID,
    status,
    start_date: START_DATE,
    trial_end: START_DATE + YEAR,
    metadata: { evmWallet: WALLET, ...metadata },
    items: {
      data: [{
        id: 'si_1',
        plan: { interval: 'year' },
        price: { id: 'price_plus_yearly', product: productId, nickname: 'plus yearly' },
        current_period_start: periodStart,
        current_period_end: periodStart + YEAR,
      }],
    },
    customer: { id: 'cus_1', email: 'testing@likecoin.store' },
    discounts: [],
  });
}

function processInvoice(billingReason = 'subscription_create', amountPaid = 0) {
  invoiceSeq += 1;
  return processStripeSubscriptionInvoice({
    id: `in_gift_funding_${invoiceSeq}`,
    amount_paid: amountPaid,
    currency: 'usd',
    billing_reason: billingReason,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
    },
  } as never, req as never);
}

function seedGiftSession({ amountTotal = 79800, currency = 'hkd', settledUSD = 102.3 as number | null } = {}) {
  mockSessionRetrieve.mockResolvedValue({
    id: 'cs_gift',
    amount_total: amountTotal,
    currency,
    payment_intent: settledUSD === null ? null : {
      latest_charge: { balance_transaction: { amount: settledUSD * 100, currency: 'usd' } },
    },
  });
}

async function readLikerPlus(): Promise<LikerPlusData> {
  return (await userCollection.doc('testing').get()).data()?.likerPlus;
}

const CLAIM_RECORD: LikerPlusData = {
  period: 'year',
  since: START_DATE * 1000,
  currentPeriodStart: START_DATE * 1000,
  currentPeriodEnd: (START_DATE + YEAR) * 1000,
  currentType: 'gift',
  subscriptionId: SUB_ID,
  customerId: 'cus_1',
};

describe('Stripe Plus term funding', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await likePlusGiftCartCollection.doc(GIFT_CART_ID).set({ sessionId: 'cs_gift' } as any);
    await userCollection.doc('testing').update({ likerPlus: FieldValue.delete() });
  });

  // The stub's reset re-reads a cached fixture, so a live record would leak into later files.
  afterEach(async () => {
    await userCollection.doc('testing').update({ likerPlus: FieldValue.delete() });
  });

  it('prices the gift term from the settled USD purchase over the gift days', async () => {
    seedSubscription();
    seedGiftSession();
    await processInvoice();
    const likerPlus = await readLikerPlus();
    expect(likerPlus.currentType).toBe('gift');
    expect(likerPlus.dailyValue).toBeCloseTo(102.3 / 365, 10);
    expect(likerPlus.dailyValueCurrency).toBe('USD');
    expect(mockRecordAccrual).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: SUB_ID,
      dailyValueUSD: expect.closeTo(102.3 / 365, 10),
      currency: 'HKD',
      currentPeriodStart: START_DATE * 1000,
      currentPeriodEnd: (START_DATE + YEAR) * 1000,
    }));
  });

  it('converts the purchase by price tier when the charge has no balance transaction', async () => {
    seedSubscription();
    seedGiftSession({ amountTotal: 6999, currency: 'usd', settledUSD: null });
    await processInvoice();
    expect((await readLikerPlus()).dailyValue).toBeCloseTo(69.99 / 365, 10);
  });

  it('funds nothing for a gift bought with a 100%-off coupon', async () => {
    seedSubscription();
    seedGiftSession({ amountTotal: 0, settledUSD: null });
    await processInvoice();
    const likerPlus = await readLikerPlus();
    expect(likerPlus.currentType).toBe('gift');
    expect(likerPlus.dailyValue).toBe(0);
    expect(mockRecordAccrual).not.toHaveBeenCalled();
  });

  it('keeps an ordinary trial unfunded', async () => {
    seedSubscription({ metadata: {} });
    await processInvoice();
    const likerPlus = await readLikerPlus();
    expect(likerPlus.currentType).toBe('trial');
    expect(likerPlus.dailyValue).toBe(0);
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    expect(mockRecordAccrual).not.toHaveBeenCalled();
  });

  it('prices the converted renewal from its own invoice', async () => {
    seedSubscription({ status: 'active', periodStart: START_DATE + YEAR });
    await processInvoice('subscription_cycle', 6999);
    const likerPlus = await readLikerPlus();
    expect(likerPlus.currentType).toBe('paid');
    expect(likerPlus.dailyValue).toBeCloseTo(69.99 / 365, 10);
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
  });

  it.each([
    ['funds a paid Civic term at the Plus-equivalent price', 99900, true],
    ['keeps a 100%-off Civic term unfunded', 0, false],
  ])('%s', async (_, amountPaid, isFunded) => {
    seedSubscription({ status: 'active', metadata: {}, productId: 'prod_civic' });
    await processInvoice('subscription_create', amountPaid);
    const likerPlus = await readLikerPlus();
    expect(likerPlus.tier).toBe('civic');
    expect(likerPlus.dailyValue > 0).toBe(isFunded);
    expect(mockRecordAccrual).toHaveBeenCalledTimes(isFunded ? 1 : 0);
  });

  it.each([
    ['the claim lands first', true],
    ['the invoice lands first', false],
  ])('ends in the invoice record when %s', async (_, isClaimFirst) => {
    seedSubscription();
    seedGiftSession();
    if (isClaimFirst) await writePlusGiftClaimRecord('testing', CLAIM_RECORD);
    await processInvoice();
    if (!isClaimFirst) await writePlusGiftClaimRecord('testing', CLAIM_RECORD);
    const likerPlus = await readLikerPlus();
    expect(likerPlus).toMatchObject({
      currentType: 'gift',
      provider: 'stripe',
      subscriptionStatus: 'active',
      dailyValueCurrency: 'USD',
    });
    expect(likerPlus.dailyValue).toBeCloseTo(102.3 / 365, 10);
  });

  it('replaces a record from an earlier subscription on claim', async () => {
    await userCollection.doc('testing').update({
      likerPlus: { ...CLAIM_RECORD, subscriptionId: 'sub_old', currentType: 'paid' },
    });
    await writePlusGiftClaimRecord('testing', CLAIM_RECORD);
    expect(await readLikerPlus()).toEqual(CLAIM_RECORD);
  });
});
