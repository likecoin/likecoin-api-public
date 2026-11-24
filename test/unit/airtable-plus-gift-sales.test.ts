import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockCreate, mockUpdate, mockFirstPage } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockFirstPage: vi.fn(),
}));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return () => ({
        create: mockCreate,
        update: mockUpdate,
        select: () => ({ firstPage: mockFirstPage }),
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
  createAirtablePlusGiftSalesRecord,
  updateAirtablePlusGiftSalesRecord,
} = await import('../../src/util/airtable');

const WALLET = '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa'; // user `testing` in test/data/user.json

const SESSION = {
  id: 'cs_gift',
  amount_total: 9900,
  currency: 'hkd',
  customer_details: { email: 'buyer@example.com' },
  metadata: {
    evmWallet: WALLET,
    giftToEmail: 'friend@example.com',
    giftToName: 'Friend',
    giftFromName: 'Buyer',
    giftMessage: 'Enjoy',
    from: 'gift-shop',
    utmSource: 'newsletter',
    fbc: 'fb.1.1747000000000.abc',
  },
} as any;

const PI = {
  id: 'pi_gift',
  latest_charge: {
    balance_transaction: {
      amount: 1270,
      currency: 'usd',
      exchange_rate: 0.128,
    },
  },
} as any;

describe('createAirtablePlusGiftSalesRecord', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('writes a paid row with buyer, gift, and balance transaction fields', async () => {
    await createAirtablePlusGiftSalesRecord({
      giftCartId: 'cart_1',
      session: SESSION,
      pi: PI,
      stripeFeeAmount: 70,
      coupon: 'XMAS',
      period: 'yearly',
      quantity: 2,
      price: { id: 'price_gift_yearly', nickname: 'Gift Yearly' } as any,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [[{ fields }]] = mockCreate.mock.calls[0];
    expect(fields).toMatchObject({
      'Gift Cart ID': 'cart_1',
      Status: 'paid',
      Period: 'yearly',
      Quantity: 2,
      'Price ID': 'price_gift_yearly',
      'Price Name': 'Gift Yearly',
      'Customer Email': 'buyer@example.com',
      'Customer Wallet': WALLET,
      'Customer User ID': 'testing',
      'Gift To Email': 'friend@example.com',
      'Gift To Name': 'Friend',
      'Gift From Name': 'Buyer',
      'Gift Message': 'Enjoy',
      'Payment Amount': 99,
      'Payment Currency': 'hkd',
      'Balance Tx Amount': 12.7,
      'Balance Tx Currency': 'usd',
      'Balance Tx Exchange Rate': 0.128,
      'Balance Tx Net Amount': 12,
      'Stripe Fee': 0.7,
      Coupon: 'XMAS',
      'Payment Intent ID': 'pi_gift',
      'Checkout Session ID': 'cs_gift',
      Channel: 'gift-shop',
      'UTM Source': 'newsletter',
      'FB Click ID': 'fb.1.1747000000000.abc',
    });
  });

  it('keeps the session payment intent ID without an expanded payment intent', async () => {
    await createAirtablePlusGiftSalesRecord({
      giftCartId: 'cart_1',
      session: { ...SESSION, payment_intent: 'pi_gift' },
      stripeFeeAmount: 0,
      period: 'yearly',
      quantity: 1,
      price: { id: 'price_gift_yearly', nickname: null } as any,
    });
    const [[{ fields }]] = mockCreate.mock.calls[0];
    expect(fields['Payment Intent ID']).toBe('pi_gift');
    expect(fields).not.toHaveProperty('Balance Tx Amount');
  });

  it('does not throw when Airtable rejects the write', async () => {
    mockCreate.mockRejectedValue(new Error('INVALID_VALUE_FOR_COLUMN'));
    await expect(createAirtablePlusGiftSalesRecord({
      giftCartId: 'cart_1',
      session: SESSION,
      stripeFeeAmount: 0,
      period: 'monthly',
      quantity: 1,
      price: { id: 'price_gift_monthly', nickname: null } as any,
    })).resolves.toBeUndefined();
  });
});

describe('updateAirtablePlusGiftSalesRecord', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockFirstPage.mockReset();
  });

  it('marks the row claimed and links the claim payment', async () => {
    mockFirstPage.mockResolvedValue([{ id: 'recGift' }]);
    await updateAirtablePlusGiftSalesRecord({
      giftCartId: 'cart_1',
      status: 'claimed',
      claimedSubscriptionId: 'sub_1',
      claimerEmail: 'friend@example.com',
      claimerUserId: 'testuser',
      claimPaymentRecordId: 'recPayment',
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [recordId, fields] = mockUpdate.mock.calls[0];
    expect(recordId).toBe('recGift');
    expect(fields).toMatchObject({
      Status: 'claimed',
      'Claimed Subscription ID': 'sub_1',
      'Claimer Email': 'friend@example.com',
      'Claimer User ID': 'testuser',
      'Claim Payment': ['recPayment'],
    });
    expect(fields['Claimed Date']).toEqual(expect.any(String));
  });

  it('only sets Status on error', async () => {
    mockFirstPage.mockResolvedValue([{ id: 'recGift' }]);
    await updateAirtablePlusGiftSalesRecord({ giftCartId: 'cart_1', status: 'error' });
    expect(mockUpdate.mock.calls[0][1]).toEqual({ Status: 'error' });
  });

  it('only links the claim payment without a status', async () => {
    mockFirstPage.mockResolvedValue([{ id: 'recGift' }]);
    await updateAirtablePlusGiftSalesRecord({ giftCartId: 'cart_1', claimPaymentRecordId: 'recPayment' });
    expect(mockUpdate.mock.calls[0][1]).toEqual({ 'Claim Payment': ['recPayment'] });
  });

  it('skips the update without throwing when the row is missing', async () => {
    mockFirstPage.mockResolvedValue([]);
    await expect(updateAirtablePlusGiftSalesRecord({
      giftCartId: 'cart_old',
      status: 'claimed',
    })).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
