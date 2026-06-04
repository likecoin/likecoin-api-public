import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';

const PATH = '/api/plus/admin/reading/settle';
const SWEEP_PATH = '/api/plus/admin/reading/sweep';
const AUTH = 'test-plus-settle-admin-token'; // matches PLUS_SETTLE_ADMIN_TOKEN in test/setup.ts
const AUTH_HEADER = { Authorization: `Bearer ${AUTH}` };

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
