import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { likeNFTBookUserCollection, configCollection } from '../../src/util/firebase';
import { getPlusReadingReportForWallet } from '../../src/util/api/plus/report';
import mockEVMAddress from '../api/address';

const WALLET = mockEVMAddress(0x9999);
const BOOK_A = mockEVMAddress('aaa');
const BOOK_B = mockEVMAddress('bbb');

// Reseed per test: the firebase stub clears these collections before each test.
beforeEach(async () => {
  // Parent docs must exist before their subcollections persist in the firebase stub.
  await likeNFTBookUserCollection.doc(WALLET).set({ wallet: WALLET } as any);
  const payouts = likeNFTBookUserCollection.doc(WALLET).collection('plusReadingPayouts');
  await payouts.doc(`2026-03_${BOOK_B}`).set({
    periodId: '2026-03',
    classId: BOOK_B,
    amountCents: 300,
    currency: 'usd',
    status: 'paid',
    readingTimeMs: 60000,
    ttsTimeMs: 0,
    transferId: 'tr_1',
  } as any);
  await payouts.doc(`2026-03_${BOOK_A}`).set({
    periodId: '2026-03',
    classId: BOOK_A,
    amountCents: 200,
    currency: 'usd',
    status: 'pending',
    readingTimeMs: 0,
    ttsTimeMs: 120000,
  } as any);
  await payouts.doc(`2026-02_${BOOK_A}`).set({
    periodId: '2026-02',
    classId: BOOK_A,
    amountCents: 100,
    currency: 'usd',
    status: 'paid',
    readingTimeMs: 30000,
    ttsTimeMs: 0,
  } as any);

  await configCollection.doc('plusReadingRevShare').set({} as any);
  await configCollection.doc('plusReadingRevShare').collection('periods').doc('2026-03').set({
    readRatePerMin: 0.5,
    ttsRatePerMin: 0.25,
  } as any);
});

describe('getPlusReadingReportForWallet', () => {
  it('sorts newest period first then by book, joins period unit rates, and rolls up the summary', async () => {
    const report = await getPlusReadingReportForWallet(WALLET);

    expect(report.payouts.map((p) => `${p.periodId}/${p.classId}`)).toEqual([
      `2026-03/${BOOK_A}`,
      `2026-03/${BOOK_B}`,
      `2026-02/${BOOK_A}`,
    ]);
    // Settled period's unit rates joined onto its payouts; the unsettled period stays at 0.
    expect(report.payouts[0]).toMatchObject({ readRatePerMin: 0.5, ttsRatePerMin: 0.25 });
    expect(report.payouts[2]).toMatchObject({ readRatePerMin: 0, ttsRatePerMin: 0 });

    expect(report.summary).toEqual({
      totalCents: 600,
      paidCents: 400,
      pendingCents: 200,
      periodCount: 2,
      bookCount: 2,
    });
  });

  it('filters to a single period when one is given', async () => {
    const report = await getPlusReadingReportForWallet(WALLET, { periodId: '2026-03' });
    expect(report.payouts).toHaveLength(2);
    expect(report.summary).toMatchObject({
      totalCents: 500,
      paidCents: 300,
      pendingCents: 200,
      periodCount: 1,
      bookCount: 2,
    });
  });

  it('returns an empty report for a wallet with no payouts', async () => {
    const report = await getPlusReadingReportForWallet(mockEVMAddress(0));
    expect(report.payouts).toEqual([]);
    expect(report.summary).toEqual({
      totalCents: 0,
      paidCents: 0,
      pendingCents: 0,
      periodCount: 0,
      bookCount: 0,
    });
  });
});
