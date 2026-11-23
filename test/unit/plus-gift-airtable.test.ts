import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const {
  mockListLineItems,
  mockPaymentIntentRetrieve,
  mockCreateGiftSales,
} = vi.hoisted(() => ({
  mockListLineItems: vi.fn(),
  mockPaymentIntentRetrieve: vi.fn(),
  mockCreateGiftSales: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getStripeClient: () => ({
    checkout: { sessions: { listLineItems: mockListLineItems } },
    paymentIntents: { retrieve: mockPaymentIntentRetrieve },
  }),
  getStripeFeeFromPaymentIntent: vi.fn().mockReturnValue(70),
  getStripePromotionCodesFromCheckoutSession: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  createAirtablePlusGiftSalesRecord: mockCreateGiftSales,
}));

vi.mock('../../src/util/ses', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  sendPlusGiftPendingClaimEmail: vi.fn(),
}));

vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn() }));

// Mutate the real config singleton rather than mocking config/config, which would
// turn it into a strict-ESM module and break consumers reading unset keys.
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_GIFT_YEARLY_PRICE_ID = 'price_gift_yearly';
cfg.LIKER_PLUS_GIFT_MONTHLY_PRICE_ID = 'price_gift_monthly';

// eslint-disable-next-line import/first
const {
  processPlusGiftStripePurchase,
} = await import('../../src/util/api/plus/gift');
// eslint-disable-next-line import/first
import { likePlusGiftCartCollection } from '../../src/util/firebase';

// The gift cart stub collection is not reset between tests, so each test takes a fresh ID.
let cartSeq = 0;
let cartId = '';
const CLAIM_TOKEN = 'token_1';

function makeSession() {
  return {
    id: 'cs_gift',
    amount_total: 9900,
    currency: 'usd',
    payment_intent: 'pi_gift',
    customer_details: { email: 'buyer@example.com' },
    metadata: {
      store: 'plus_gift',
      cartId,
      paymentId: cartId,
      claimToken: CLAIM_TOKEN,
      giftToEmail: 'friend@example.com',
      giftToName: 'Friend',
      giftFromName: 'Buyer',
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  cartSeq += 1;
  cartId = `cart_gift_${cartSeq}`;
  mockListLineItems.mockResolvedValue({
    data: [{ quantity: 1, price: { id: 'price_gift_yearly', nickname: 'Gift Yearly' } }],
  });
  mockPaymentIntentRetrieve.mockResolvedValue({ id: 'pi_gift' });
});

describe('processPlusGiftStripePurchase', () => {
  it('writes one gift sales row per purchase', async () => {
    const session = makeSession();
    await processPlusGiftStripePurchase(session);
    expect(mockCreateGiftSales).toHaveBeenCalledTimes(1);
    expect(mockCreateGiftSales.mock.calls[0][0]).toMatchObject({
      giftCartId: cartId,
      session,
      pi: { id: 'pi_gift' },
      stripeFeeAmount: 70,
      coupon: undefined,
      period: 'yearly',
      quantity: 1,
      price: { id: 'price_gift_yearly' },
    });
  });

  it('does not write again on a duplicate webhook', async () => {
    await processPlusGiftStripePurchase(makeSession());
    await processPlusGiftStripePurchase(makeSession());
    expect(mockCreateGiftSales).toHaveBeenCalledTimes(1);
  });

  it('still records the sale without fee detail when the Stripe lookup fails', async () => {
    mockPaymentIntentRetrieve.mockRejectedValue(new Error('stripe down'));
    await processPlusGiftStripePurchase(makeSession());
    expect((await likePlusGiftCartCollection.doc(cartId).get()).exists).toBe(true);
    expect(mockCreateGiftSales).toHaveBeenCalledTimes(1);
    expect(mockCreateGiftSales.mock.calls[0][0]).toMatchObject({
      giftCartId: cartId,
      pi: undefined,
      stripeFeeAmount: 0,
    });
  });
});
