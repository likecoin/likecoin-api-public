import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

const { mockTransferCreate } = vi.hoisted(() => ({
  mockTransferCreate: vi.fn(),
}));

vi.mock('../../src/util/stripe', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getStripeClient: () => ({ transfers: { create: mockTransferCreate } }),
  };
});

// eslint-disable-next-line import/first
import { sweepPlusReadingPendingPayouts } from '../../src/util/api/plus/settleJob';
// eslint-disable-next-line import/first
import { likeNFTBookCollection, likeNFTBookUserCollection } from '../../src/util/firebase';

const PERIOD = '2026-01';

// Seeds one Connect-ready payee with a pending payout, the shape the sweep re-attempts.
// The pending record stores only the classId, so the title comes from the book doc.
async function seedPending(classId: string, wallet: string, {
  name, amountCents = 100,
}: { name?: unknown; amountCents?: number } = {}) {
  if (name !== undefined) {
    await likeNFTBookCollection.doc(classId).set({ classId, name } as any, { merge: true });
  }
  await likeNFTBookUserCollection.doc(wallet).set({
    isStripeConnectReady: true,
    stripeConnectAccountId: `acct_${wallet}`,
  } as any, { merge: true });
  await likeNFTBookUserCollection.doc(wallet)
    .collection('plusReadingPayouts').doc(`${PERIOD}_${classId}`)
    .set({
      periodId: PERIOD, classId, wallet, amountCents, status: 'pending',
    } as any);
}

const descriptionOf = (call: number = 0) => mockTransferCreate.mock.calls[call][0].description;

describe('sweepPlusReadingPendingPayouts transfer description', () => {
  beforeEach(() => {
    mockTransferCreate.mockReset();
    mockTransferCreate.mockImplementation(async () => ({ id: 'tr_test' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labels the transfer with the book title', async () => {
    await seedPending('0xbook1', '0xwallet1', { name: 'The Great Book' });

    const res = await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(res.paidCount).toBe(1);
    expect(mockTransferCreate).toHaveBeenCalledTimes(1);
    expect(descriptionOf()).toBe(`Li3rary revenue share ${PERIOD} (The Great Book)`);
  });

  it('truncates an overlong title', async () => {
    const longName = 'a'.repeat(250);
    await seedPending('0xbook2', '0xwallet2', { name: longName });

    await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(descriptionOf()).toBe(`Li3rary revenue share ${PERIOD} (${'a'.repeat(200)})`);
  });

  it('falls back to the classId when the book doc has no title', async () => {
    await seedPending('0xbook3', '0xwallet3');

    await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(descriptionOf()).toBe(`Li3rary revenue share ${PERIOD} (0xbook3)`);
  });

  it('falls back to the classId when a legacy doc holds a non-string title', async () => {
    await seedPending('0xbook4', '0xwallet4', { name: { en: 'Localized' } });

    await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(descriptionOf()).toBe(`Li3rary revenue share ${PERIOD} (0xbook4)`);
  });

  it('still transfers when the title read fails', async () => {
    await seedPending('0xbook5', '0xwallet5', { name: 'Unreadable' });
    vi.spyOn(likeNFTBookCollection, 'doc').mockReturnValue({
      get: () => Promise.reject(new Error('firestore unavailable')),
    } as any);

    const res = await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(res.paidCount).toBe(1);
    expect(descriptionOf()).toBe(`Li3rary revenue share ${PERIOD} (0xbook5)`);
  });

  it('reads the book doc once for payees sharing a book', async () => {
    await seedPending('0xbook6', '0xwallet6a', { name: 'Shared Book' });
    await seedPending('0xbook6', '0xwallet6b');
    const docSpy = vi.spyOn(likeNFTBookCollection, 'doc');

    await sweepPlusReadingPendingPayouts({ dryRun: false });

    expect(mockTransferCreate).toHaveBeenCalledTimes(2);
    expect(docSpy).toHaveBeenCalledTimes(1);
    expect(descriptionOf(0)).toBe(`Li3rary revenue share ${PERIOD} (Shared Book)`);
    expect(descriptionOf(1)).toBe(`Li3rary revenue share ${PERIOD} (Shared Book)`);
  });
});
