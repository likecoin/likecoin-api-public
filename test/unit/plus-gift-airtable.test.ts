import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const {
  mockListLineItems,
  mockPaymentIntentRetrieve,
  mockCustomerCreate,
  mockSubscriptionCreate,
  mockCreateGiftSales,
  mockUpdateGiftSales,
  mockCreateSubscriptionPayment,
} = vi.hoisted(() => ({
  mockListLineItems: vi.fn(),
  mockPaymentIntentRetrieve: vi.fn(),
  mockCustomerCreate: vi.fn(),
  mockSubscriptionCreate: vi.fn(),
  mockCreateGiftSales: vi.fn(),
  mockUpdateGiftSales: vi.fn(),
  mockCreateSubscriptionPayment: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getStripeClient: () => ({
    checkout: { sessions: { listLineItems: mockListLineItems } },
    paymentIntents: { retrieve: mockPaymentIntentRetrieve },
    customers: { create: mockCustomerCreate },
    subscriptions: { create: mockSubscriptionCreate },
  }),
  getStripeFeeFromPaymentIntent: vi.fn().mockReturnValue(70),
  getStripePromotionCodesFromCheckoutSession: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  createAirtablePlusGiftSalesRecord: mockCreateGiftSales,
  updateAirtablePlusGiftSalesRecord: mockUpdateGiftSales,
  createAirtableSubscriptionPaymentRecord: mockCreateSubscriptionPayment,
}));

vi.mock('../../src/util/ses', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  sendPlusGiftPendingClaimEmail: vi.fn(),
  sendPlusGiftClaimedEmail: vi.fn(),
}));

vi.mock('../../src/util/intercom', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  sendIntercomEvent: vi.fn(),
  updateIntercomUserAttributes: vi.fn(),
}));

vi.mock('../../src/util/logServerEvents', () => ({ default: vi.fn() }));

// Mutate the real config singleton rather than mocking config/config, which would
// turn it into a strict-ESM module and break consumers reading unset keys.
// eslint-disable-next-line import/first, import/no-relative-packages
import config from '../../config/config';

const cfg = config as Record<string, unknown>;
cfg.LIKER_PLUS_GIFT_YEARLY_PRICE_ID = 'price_gift_yearly';
cfg.LIKER_PLUS_GIFT_MONTHLY_PRICE_ID = 'price_gift_monthly';
cfg.LIKER_PLUS_YEARLY_PRICE_ID = 'price_plus_yearly';
cfg.LIKER_PLUS_MONTHLY_PRICE_ID = 'price_plus_monthly';

// eslint-disable-next-line import/first
const {
  processPlusGiftStripePurchase,
  claimPlusGiftCart,
} = await import('../../src/util/api/plus/gift');
// eslint-disable-next-line import/first
import { likePlusGiftCartCollection } from '../../src/util/firebase';

// The gift cart stub collection is not reset between tests, so each test takes a fresh ID.
let cartSeq = 0;
let cartId = '';
const CLAIM_TOKEN = 'token_1';
const CLAIMER_WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json

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

  it('keeps the buyer UTM on the cart for the claim payment row', async () => {
    const session = makeSession();
    session.metadata.utmCampaign = 'gift_campaign';
    session.metadata.utmSource = 'newsletter';
    await processPlusGiftStripePurchase(session);
    const cartData = (await likePlusGiftCartCollection.doc(cartId).get()).data();
    expect(cartData).toMatchObject({ utmCampaign: 'gift_campaign', utmSource: 'newsletter' });
    expect(cartData).not.toHaveProperty('utmMedium');
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

describe('claimPlusGiftCart', () => {
  beforeEach(async () => {
    await likePlusGiftCartCollection.doc(cartId).set({
      id: cartId,
      email: 'buyer@example.com',
      period: 'yearly',
      quantity: 1,
      giftInfo: { toEmail: 'friend@example.com', toName: 'Friend', fromName: 'Buyer' },
      status: 'paid',
      claimToken: CLAIM_TOKEN,
    } as any);
    mockCustomerCreate.mockResolvedValue({ id: 'cus_claimer' });
  });

  it('marks the gift sales row claimed', async () => {
    mockSubscriptionCreate.mockResolvedValue({
      id: 'sub_gift',
      start_date: 1747000000,
      items: {
        data: [{
          plan: { interval: 'year' },
          price: { id: 'price_plus_yearly', product: 'prod_plus', nickname: 'Yearly' },
          current_period_start: 1747000000,
          current_period_end: 1778536000,
        }],
      },
    });
    await claimPlusGiftCart({ cartId, token: CLAIM_TOKEN, wallet: CLAIMER_WALLET });
    // The trial invoice's webhook writes the payment row and links it.
    expect(mockCreateSubscriptionPayment).not.toHaveBeenCalled();
    expect(mockUpdateGiftSales).toHaveBeenCalledTimes(1);
    expect(mockUpdateGiftSales).toHaveBeenCalledWith({
      giftCartId: cartId,
      status: 'claimed',
      claimedSubscriptionId: 'sub_gift',
      claimerEmail: 'testing@likecoin.store',
      claimerUserId: 'testing',
    });
  });

  it('marks the gift sales row error when the claim fails', async () => {
    mockSubscriptionCreate.mockRejectedValue(new Error('card declined'));
    await expect(claimPlusGiftCart({
      cartId,
      token: CLAIM_TOKEN,
      wallet: CLAIMER_WALLET,
    })).rejects.toThrow('card declined');
    expect(mockUpdateGiftSales).toHaveBeenCalledWith({ giftCartId: cartId, status: 'error' });
  });
});
