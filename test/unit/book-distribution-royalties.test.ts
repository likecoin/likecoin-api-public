import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { likeNFTBookUserCollection } from '../../src/util/firebase';
import { getDistributionRoyaltiesForWallet } from '../../src/util/api/likernft/book/user';
import { BookUserDistributionRoyaltiesResponseSchema } from '../../src/util/api/likernft/book/schemas';
import { makeTimestampFromMillis as ts } from '../stub/firebase';
import mockEVMAddress from '../api/address';

const WALLET = mockEVMAddress(0x9998);

// Reseed per test: the firebase stub clears these collections before each test.
beforeEach(async () => {
  // Parent docs must exist before their subcollections persist in the firebase stub.
  await likeNFTBookUserCollection.doc(WALLET).set({ wallet: WALLET } as any);
  const royalties = likeNFTBookUserCollection.doc(WALLET).collection('distributionRoyalties');
  // Seeded oldest first to check the newest-first sort.
  await royalties.doc('2026Q1').set({
    period: '2026Q1',
    periodStart: ts(1767225600000),
    grossUsd: 100,
    feeUsd: 10,
    payableUsd: 90,
    status: 'paid',
    payments: [{
      paymentId: 'py_1',
      transferId: 'tr_1',
      paidAt: ts(1777593600000),
      amountUsd: 90,
      payoutId: 'po_1',
    }],
    updatedAt: ts(1777593600000),
  } as any);
  // A partial doc: no period field, payments or updatedAt.
  await royalties.doc('2026Q2').set({
    periodStart: ts(1775001600000),
    grossUsd: 50,
    feeUsd: 5,
    payableUsd: 45,
    status: 'unpaid',
  } as any);
});

describe('getDistributionRoyaltiesForWallet', () => {
  it('maps quarter docs newest first', async () => {
    const { royalties } = await getDistributionRoyaltiesForWallet(WALLET);

    expect(royalties.map((r) => r.period)).toEqual(['2026Q2', '2026Q1']);
    expect(royalties[1]).toEqual({
      period: '2026Q1',
      periodStart: 1767225600000,
      grossUsd: 100,
      feeUsd: 10,
      payableUsd: 90,
      status: 'paid',
      payments: [{
        paymentId: 'py_1',
        transferId: 'tr_1',
        paidAt: 1777593600000,
        amountUsd: 90,
        payoutId: 'po_1',
      }],
      updatedAt: 1777593600000,
    });
  });

  it('fills a partial doc so the response schema still accepts it', async () => {
    const result = await getDistributionRoyaltiesForWallet(WALLET);

    expect(result.royalties[0]).toMatchObject({
      period: '2026Q2',
      status: 'unpaid',
      payments: [],
    });
    expect(result.royalties[0].updatedAt).toBeUndefined();
    const parsed = BookUserDistributionRoyaltiesResponseSchema.safeParse(result);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('returns an empty list for a wallet with no royalties', async () => {
    const result = await getDistributionRoyaltiesForWallet(mockEVMAddress(0));
    expect(result).toEqual({ royalties: [] });
  });
});
