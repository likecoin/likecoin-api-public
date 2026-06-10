import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { configCollection, likeNFTBookCollection } from '../../src/util/firebase';
import { ONE_MINUTE_IN_MS } from '../../src/constant';

const PATH = '/api/plus/admin/reading/settle';
const SWEEP_PATH = '/api/plus/admin/reading/sweep';
const AUTH = 'test-plus-settle-admin-token'; // matches PLUS_SETTLE_ADMIN_TOKEN in test/setup.ts
const AUTH_HEADER = { Authorization: `Bearer ${AUTH}` };

const min = (n: number) => n * ONE_MINUTE_IN_MS;

// Seed a book with a daily usage rollup (the shape recordPlusReadingUsage writes).
async function seedUsage(classId: string, dayId: string, dayMs: number, readingTimeMs: number) {
  await likeNFTBookCollection.doc(classId)
    .set({ classId, ownerWallet: mockEVMAddress(0x66) } as any, { merge: true });
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
});
