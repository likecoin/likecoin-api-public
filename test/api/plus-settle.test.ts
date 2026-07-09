import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { configCollection, likeNFTBookCollection, likeNFTBookUserCollection } from '../../src/util/firebase';
import { ONE_MINUTE_IN_MS } from '../../src/constant';

const PATH = '/api/plus/admin/reading/settle';
const SWEEP_PATH = '/api/plus/admin/reading/sweep';
const AUTH = 'test-plus-settle-admin-token'; // matches PLUS_SETTLE_ADMIN_TOKEN in test/setup.ts
const AUTH_HEADER = { Authorization: `Bearer ${AUTH}` };

const min = (n: number) => n * ONE_MINUTE_IN_MS;

// Seed a book with a daily usage rollup (the shape recordPlusReadingUsage writes).
async function seedUsage(
  classId: string,
  dayId: string,
  dayMs: number,
  readingTimeMs: number,
  ownerWallet = mockEVMAddress(0x66),
) {
  await likeNFTBookCollection.doc(classId)
    .set({ classId, ownerWallet } as any, { merge: true });
  await likeNFTBookCollection.doc(classId).collection('plusUsage').doc(dayId)
    .set({ readingTimeMs, ttsTimeMs: 0, dayMs } as any);
}

const postTo = (path: string) => (
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) => axiosist
  .post(path, body, headers ? { headers } : undefined)
  .catch((err) => (err as any).response);
const post = postTo(PATH);
const postSweep = postTo(SWEEP_PATH);

describe('POST /plus/admin/reading/settle', () => {
  it('rejects requests without the admin token', async () => {
    const res = await post({ periodId: '2026-03', dryRun: true });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed periodId', async () => {
    const res = await post({ periodId: '2026-3', dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('dry-run with no accrual or usage settles to an empty zero allocation', async () => {
    const res = await post({ periodId: '2026-03', dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      success: true,
      dryRun: true,
      periodId: '2026-03',
      mode: 'static',
      revShareRate: 0.3,
      poolUSD: 0,
      allocatableUSD: 0,
      allocatedUSD: 0,
      revSharePct: 0,
      // static default $0.01/min; no usage so nothing is actually allocated.
      readRatePerMin: 0.01,
      ttsRatePerMin: 0.01,
      bookCount: 0,
      paidCount: 0,
      pendingCount: 0,
      books: [],
    });
  });

  it('accepts a single-day periodId', async () => {
    const res = await post({ periodId: '2026-03-10', dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ success: true, dryRun: true, periodId: '2026-03-10' });
  });

  it('rejects an impossible calendar day', async () => {
    const res = await post({ periodId: '2026-02-30', dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(400);
  });
});

describe('POST /plus/admin/reading/settle — range allocation', () => {
  const CLASS_ID = mockEVMAddress(0x55);

  it('sums a book\'s daily usage across the month', async () => {
    await seedUsage(CLASS_ID, '2026-03-05', Date.UTC(2026, 2, 5), min(60));
    await seedUsage(CLASS_ID, '2026-03-20', Date.UTC(2026, 2, 20), min(40));

    const res = await post({ periodId: '2026-03', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data.totalReadingTimeMs).toBe(min(100));
    expect(res.data.books).toHaveLength(1);
    // static $0.01/min × 100 min = $1.00 = 100 cents.
    expect(res.data.books[0]).toMatchObject({
      classId: CLASS_ID, amountCents: 100, readingTimeMs: min(100),
    });
  });

  it('ignores non-library engagement when pricing payouts', async () => {
    await likeNFTBookCollection.doc(CLASS_ID)
      .set({ classId: CLASS_ID, ownerWallet: mockEVMAddress(0x66) } as any, { merge: true });
    // Library reading min(100), but huge non-library totals that settlement must not price.
    await likeNFTBookCollection.doc(CLASS_ID).collection('plusUsage').doc('2026-03-05')
      .set({
        readingTimeMs: min(100),
        ttsTimeMs: 0,
        nonLibraryReadingTimeMs: min(9999),
        nonLibraryTtsTimeMs: min(9999),
        dayMs: Date.UTC(2026, 2, 5),
      } as any);

    const res = await post({ periodId: '2026-03', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data.totalReadingTimeMs).toBe(min(100));
    // static $0.01/min × 100 library min = 100 cents; non-library is inert.
    expect(res.data.books[0]).toMatchObject({ classId: CLASS_ID, amountCents: 100 });
  });

  // More books than SETTLE_CONCURRENCY (20), so the payout loop spans several chunks.
  it('keeps each book\'s allocation intact across concurrency chunks', async () => {
    const classIds = Array.from({ length: 25 }, (_, i) => mockEVMAddress(0x100 + i));
    // Distinct minutes per book, so a book that picked up a neighbour's usage or amount
    // (chunk index misalignment) mismatches rather than coincidentally agreeing.
    await Promise.all(classIds.map((classId, i) => seedUsage(
      classId,
      '2026-04-05',
      Date.UTC(2026, 3, 5),
      min(10 * (i + 1)),
    )));

    const res = await post({ periodId: '2026-04', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data.books).toHaveLength(classIds.length);
    const byClassId = new Map(res.data.books.map((b) => [b.classId, b]));
    classIds.forEach((classId, i) => {
      // static $0.01/min → amountCents === minutes.
      expect(byClassId.get(classId)).toMatchObject({
        classId, readingTimeMs: min(10 * (i + 1)), amountCents: 10 * (i + 1),
      });
    });

    // `books` order is the usage-query discovery order, not payout-completion order.
    const second = await post({ periodId: '2026-04', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(second.data.books.map((b) => b.classId)).toEqual(res.data.books.map((b) => b.classId));
  });

  // The concurrent payout loop reduces its counters positionally over the outcomes array,
  // so a chunk-index drift would attribute one book's cents to another book's outcome.
  it('attributes paid vs pending cents to the right book across chunks', async () => {
    const books = Array.from({ length: 25 }, (_, i) => ({
      classId: mockEVMAddress(0x300 + i),
      ownerWallet: mockEVMAddress(0x400 + i),
      cents: 10 * (i + 1),
      isReady: i % 2 === 0, // alternate, so an off-by-one flips every classification
    }));
    await Promise.all(books.map(async ({
      classId, ownerWallet, cents, isReady,
    }) => {
      await likeNFTBookUserCollection.doc(ownerWallet).set({
        isStripeConnectReady: isReady,
        ...(isReady ? { stripeConnectAccountId: `acct_${classId}` } : {}),
      } as any, { merge: true });
      await seedUsage(classId, '2026-05-05', Date.UTC(2026, 4, 5), min(cents), ownerWallet);
    }));

    const res = await post({ periodId: '2026-05', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(res.status).toBe(200);
    const ready = books.filter((b) => b.isReady);
    const notReady = books.filter((b) => !b.isReady);
    expect(res.data.paidCount).toBe(ready.length);
    expect(res.data.pendingCount).toBe(notReady.length);
    expect(res.data.paidCents).toBe(ready.reduce((sum, b) => sum + b.cents, 0));
    expect(res.data.pendingCents).toBe(notReady.reduce((sum, b) => sum + b.cents, 0));
  });

  it('a single-day settle reads only that day', async () => {
    await seedUsage(CLASS_ID, '2026-03-05', Date.UTC(2026, 2, 5), min(60));
    await seedUsage(CLASS_ID, '2026-03-20', Date.UTC(2026, 2, 20), min(40));

    const res = await post({ periodId: '2026-03-05', dryRun: true, mode: 'static' }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data.totalReadingTimeMs).toBe(min(60));
    expect(res.data.books[0]).toMatchObject({ classId: CLASS_ID, amountCents: 60 });
  });
});

describe('POST /plus/admin/reading/settle — settle guards', () => {
  it('rejects a real settle whose window has not fully elapsed', async () => {
    const res = await post({ periodId: '2099-01' }, AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('rejects a real settle overlapping an already-settled period', async () => {
    // The completion doc lives under the revshare config doc; seed it so the `periods`
    // subcollection persists between the two settles.
    await configCollection.doc('plusReadingRevShare').set({} as any);
    // Settle a day (no usage → just writes the completion doc), then the month containing it.
    const day = await post({ periodId: '2020-03-10' }, AUTH_HEADER);
    expect(day.status).toBe(200);
    const month = await post({ periodId: '2020-03' }, AUTH_HEADER);
    expect(month.status).toBe(409);
  });
});

describe('POST /plus/admin/reading/sweep', () => {
  it('rejects requests without the admin token', async () => {
    const res = await postSweep({ dryRun: true });
    expect(res.status).toBe(401);
  });

  it('dry-run with no pending payouts sweeps nothing', async () => {
    const res = await postSweep({ dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      success: true,
      dryRun: true,
      sweptCount: 0,
      paidCount: 0,
      stillPendingCount: 0,
      paidCents: 0,
    });
  });

  // Like the settle, the sweep reduces its counters positionally over the outcomes of a
  // concurrent payout run, and it spans periods rather than settling just one.
  it('attributes swept cents to the right payout across chunks and periods', async () => {
    const payouts = Array.from({ length: 25 }, (_, i) => ({
      periodId: i % 2 === 0 ? '2026-01' : '2026-02-14',
      classId: mockEVMAddress(0x500 + i),
      wallet: mockEVMAddress(0x600 + i),
      amountCents: 10 * (i + 1),
      isReady: i % 3 === 0, // 1-in-3, so an off-by-one shifts the paid/pending boundary
    }));
    await Promise.all(payouts.map(async ({
      periodId, classId, wallet, amountCents, isReady,
    }) => {
      await likeNFTBookUserCollection.doc(wallet).set({
        isStripeConnectReady: isReady,
        ...(isReady ? { stripeConnectAccountId: `acct_${wallet}` } : {}),
      } as any, { merge: true });
      await likeNFTBookUserCollection.doc(wallet)
        .collection('plusReadingPayouts').doc(`${periodId}_${classId}`)
        .set({
          periodId, classId, wallet, amountCents, status: 'pending',
        } as any);
    }));
    // A zero-cent record is swept over but has no payout to attempt.
    const zeroWallet = mockEVMAddress(0x6ff);
    await likeNFTBookUserCollection.doc(zeroWallet)
      .set({ isStripeConnectReady: false } as any, { merge: true });
    await likeNFTBookUserCollection.doc(zeroWallet)
      .collection('plusReadingPayouts').doc('2026-01_zero')
      .set({
        periodId: '2026-01', classId: 'zero', wallet: zeroWallet, amountCents: 0, status: 'pending',
      } as any);

    const res = await postSweep({ dryRun: true }, AUTH_HEADER);
    expect(res.status).toBe(200);
    const ready = payouts.filter((p) => p.isReady);
    expect(res.data.sweptCount).toBe(payouts.length + 1);
    expect(res.data.paidCount).toBe(ready.length);
    expect(res.data.stillPendingCount).toBe(payouts.length - ready.length);
    expect(res.data.paidCents).toBe(ready.reduce((sum, p) => sum + p.amountCents, 0));
  });
});
