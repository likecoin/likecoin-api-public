import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { FieldValue, likePlusGiftCartCollection, userCollection } from '../../src/util/firebase';

const {
  mockSubscriptionRetrieve,
  mockCreatePayment,
  mockUpdateGiftSales,
} = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
  mockCreatePayment: vi.fn(),
  mockUpdateGiftSales: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getStripeClient: () => ({
    subscriptions: { retrieve: mockSubscriptionRetrieve },
    // Unimplemented on purpose: the invoice lookups are best-effort and swallow errors.
    invoices: {},
    paymentIntents: {},
  }),
}));
vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  createAirtableSubscriptionPaymentRecord: mockCreatePayment,
  updateAirtablePlusGiftSalesRecord: mockUpdateGiftSales,
}));
vi.mock('../../src/util/slack', async (importOriginal) => ({
  ...(await importOriginal() as object),
  sendPlusSubscriptionSlackNotification: vi.fn(),
}));
vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn() }));
vi.mock('../../src/util/api/plus/airdrop', () => ({ payPlusSubscriptionAirdrop: vi.fn() }));
vi.mock('../../src/util/api/plus/revenueShare', async (importOriginal) => ({
  ...(await importOriginal() as object),
  recordPlusSubscriptionAccrual: vi.fn(),
}));

// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

(config as Record<string, unknown>).LIKER_PLUS_PRODUCT_ID = 'prod_plus';

// eslint-disable-next-line import/first
const { processStripeSubscriptionInvoice } = await import('../../src/util/api/plus');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json
const SUB_ID = 'sub_gift_record';
const START_DATE = 1747000000;
const YEAR = 365 * 24 * 60 * 60;

const req = { headers: {} };

// Invoice IDs are deduped per user in the shared Firestore stub, so each call takes a fresh one.
let invoiceSeq = 0;

function seedSubscription({
  status = 'trialing',
  trialEnd = START_DATE + YEAR as number | null,
  periodStart = START_DATE,
  metadata = {} as Record<string, string>,
} = {}) {
  mockSubscriptionRetrieve.mockResolvedValue({
    id: SUB_ID,
    status,
    start_date: START_DATE,
    trial_end: trialEnd,
    metadata: { evmWallet: WALLET, ...metadata },
    items: {
      data: [{
        id: 'si_1',
        plan: { interval: 'year' },
        price: { id: 'price_plus_yearly', product: 'prod_plus', nickname: 'plus yearly' },
        current_period_start: periodStart,
        current_period_end: periodStart + YEAR,
      }],
    },
    customer: { id: 'cus_1', email: 'testing@likecoin.store' },
    discounts: [],
  });
}

function processInvoice(billingReason: string, amountPaid = 0) {
  invoiceSeq += 1;
  return processStripeSubscriptionInvoice({
    id: `in_gift_record_${invoiceSeq}`,
    amount_paid: amountPaid,
    currency: 'usd',
    billing_reason: billingReason,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: SUB_ID, metadata: { evmWallet: WALLET } },
    },
  } as never, req as never);
}

const GIFT_CART_ID = 'cart_gift_record';
const GIFT_METADATA = { isGift: 'true', giftCartId: GIFT_CART_ID };

describe('Plus Stripe invoice payment record for gift subscriptions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreatePayment.mockResolvedValue('recPayment');
    await likePlusGiftCartCollection.doc(GIFT_CART_ID).set({
      fbc: 'fb.1.1747000000000.buyer',
      utmCampaign: 'gift_campaign',
      utmSource: 'newsletter',
    } as any);
    await userCollection.doc('testing').update({
      likerPlus: {
        since: START_DATE * 1000,
        currentType: 'gift',
        provider: 'stripe',
        subscriptionId: SUB_ID,
      },
    });
  });

  // The stub's reset re-reads a cached fixture, so a live record would leak into later files.
  afterEach(async () => {
    await userCollection.doc('testing').update({ likerPlus: FieldValue.delete() });
  });

  it.each([
    ['after the claim wrote the Plus record', true],
    ['before the claim wrote the Plus record', false],
  ])('writes one new claim payment row %s', async (_, isClaimFirst) => {
    if (!isClaimFirst) await userCollection.doc('testing').update({ likerPlus: FieldValue.delete() });
    seedSubscription({ metadata: GIFT_METADATA });
    await processInvoice('subscription_create');
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: SUB_ID,
      invoiceId: `in_gift_record_${invoiceSeq}`,
      isNew: true,
      isTrial: true,
      fbc: 'fb.1.1747000000000.buyer',
      utmCampaign: 'gift_campaign',
      utmSource: 'newsletter',
    }));
    expect(mockUpdateGiftSales).toHaveBeenCalledWith({
      giftCartId: GIFT_CART_ID,
      claimPaymentRecordId: 'recPayment',
    });
  });

  it('does not link the claim when the Airtable write fails', async () => {
    mockCreatePayment.mockResolvedValue(undefined);
    seedSubscription({ metadata: GIFT_METADATA });
    await processInvoice('subscription_create');
    expect(mockUpdateGiftSales).not.toHaveBeenCalled();
  });

  it.each([
    ['a plain subscription', 'subscription_create', {}, {}],
    ['a yearly plan with a free-book cart', 'subscription_create', { giftCartId: 'cart_book' }, {}],
    ['a gift renewal', 'subscription_cycle', GIFT_METADATA, { status: 'active', trialEnd: null, periodStart: START_DATE + YEAR }],
    ['a gift trial turning paid', 'subscription_cycle', GIFT_METADATA, { status: 'active', periodStart: START_DATE + YEAR }],
  ])('leaves the claim untouched for %s', async (_, billingReason, metadata, subscription) => {
    seedSubscription({ ...subscription, metadata });
    await processInvoice(billingReason, 6999);
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment.mock.calls[0][0].fbc).toBeUndefined();
    expect(mockCreatePayment.mock.calls[0][0].utmCampaign).toBeUndefined();
    expect(mockUpdateGiftSales).not.toHaveBeenCalled();
  });
});
