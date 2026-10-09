import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return () => ({ create: mockCreate });
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
const { createAirtableSubscriptionPaymentRecord } = await import('../../src/util/airtable');

const RECORD = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  customerEmail: 'testing@likecoin.store',
  customerUserId: 'testing',
  customerWallet: '0x4b25758E41f9240C8EB8831cEc7F1a02686387fa',
  periodInterval: 'year',
  since: 1747000000000,
  periodStartAt: 1747000000000,
  periodEndAt: 1778536000000,
  utmSource: 'facebook',
};

describe('createAirtableSubscriptionPaymentRecord', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('writes fbc to FB Click ID', async () => {
    await createAirtableSubscriptionPaymentRecord({ ...RECORD, fbc: 'fb.1.1747000000000.abc' });
    const [[{ fields }]] = mockCreate.mock.calls[0];
    expect(fields['FB Click ID']).toBe('fb.1.1747000000000.abc');
  });

  it('omits FB Click ID without fbc', async () => {
    // Airtable rejects the whole create on an unknown field,
    // so the column must stay out of the payload until there is a value.
    await createAirtableSubscriptionPaymentRecord(RECORD);
    const [[{ fields }]] = mockCreate.mock.calls[0];
    expect(fields).not.toHaveProperty('FB Click ID');
    expect(fields['UTM Source']).toBe('facebook');
  });
});
