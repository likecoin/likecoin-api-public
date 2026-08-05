import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection } from '../../src/util/firebase';
import {
  READING_SCORE_EPOCH_MS,
  READING_SCORE_HALF_LIFE_DAYS,
  getReadingScoreIncrement,
} from '../../src/util/api/likernft/book/popularity';

const DAY_MS = 24 * 60 * 60 * 1000;

const PATH = '/api/likernft/book/store/list/popular';
const OWNER = mockEVMAddress(0x33);

// The stub firestore no-ops orderBy/limit/startAfter, so rank order and cursor paging are
// not exercised here — those depend on the composite index and need a real Firestore.
// What is exercised: the library scope flag, hidden/redirect exclusion, the null-cursor
// boundary, cursor validation, and the score math feeding the usage-time increment.
const seedBook = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId,
    ownerWallet: OWNER,
    isPlusReadingEnabled: true,
    plusReadingTotalMs: 0,
    plusReadingScore: 0,
    ...data,
  } as any);

const get = (query = '') => axiosist
  .get(`${PATH}${query}`)
  .catch((err) => (err as any).response);

describe('GET /likernft/book/store/list/popular', () => {
  it('scopes to Plus-reading books with library=1', async () => {
    const inLibrary = mockEVMAddress(0xa1);
    const notInLibrary = mockEVMAddress(0xa2);
    await seedBook(inLibrary, { plusReadingTotalMs: 5000 });
    await seedBook(notInLibrary, { isPlusReadingEnabled: false });

    const res = await get('?library=1');
    expect(res.status).toBe(200);
    const classIds = res.data.list.map((b: any) => b.classId);
    expect(classIds).toContain(inLibrary);
    expect(classIds).not.toContain(notInLibrary);
  });

  it('lists the whole catalogue without library=1', async () => {
    const inLibrary = mockEVMAddress(0xb1);
    const notInLibrary = mockEVMAddress(0xb2);
    await seedBook(inLibrary);
    await seedBook(notInLibrary, { isPlusReadingEnabled: false });

    const res = await get();
    expect(res.status).toBe(200);
    const classIds = res.data.list.map((b: any) => b.classId);
    expect(classIds).toContain(inLibrary);
    expect(classIds).toContain(notInLibrary);
  });

  it('does not leak the popularity counters to clients', async () => {
    const classId = mockEVMAddress(0xa3);
    await seedBook(classId, { plusReadingTotalMs: 123456, plusReadingScore: 98765 });

    const res = await get();
    const book = res.data.list.find((b: any) => b.classId === classId);
    expect(book).toBeDefined();
    // Rank order is public; the minutes behind it (the payout basis) are not.
    expect(book.plusReadingTotalMs).toBeUndefined();
    expect(book.plusReadingScore).toBeUndefined();
  });

  it('excludes hidden and redirected books from the list', async () => {
    const visible = mockEVMAddress(0xa4);
    const hidden = mockEVMAddress(0xa5);
    const redirected = mockEVMAddress(0xa6);
    await seedBook(visible);
    await seedBook(hidden, { isHidden: true });
    await seedBook(redirected, { redirectClassId: visible });

    const res = await get();
    const classIds = res.data.list.map((b: any) => b.classId);
    expect(classIds).toContain(visible);
    expect(classIds).not.toContain(hidden);
    expect(classIds).not.toContain(redirected);
  });

  it('returns a null cursor when the page is not full', async () => {
    await seedBook(mockEVMAddress(0xa7));

    const res = await get('?limit=100');
    expect(res.status).toBe(200);
    expect(res.data.nextKey).toBeNull();
  });

  it('rejects a cursor that names no book', async () => {
    const res = await get(`?key=${mockEVMAddress(0xbb)}`);
    expect(res.status).toBe(400);
  });

  it('accepts a mixed-case class id as the cursor', async () => {
    // Books are keyed by lowercase class id; an EIP-55 checksummed cursor must still resolve.
    const mixedCaseClassId = '0xAbCdEf8888888888888888888888888888888888';
    await seedBook(mixedCaseClassId.toLowerCase());

    const res = await get(`?key=${mixedCaseClassId}`);
    expect(res.status).toBe(200);
  });
});

describe('getReadingScoreIncrement', () => {
  it('weighs usage one half-life later exactly twice as much', () => {
    const halfLifeMs = READING_SCORE_HALF_LIFE_DAYS * DAY_MS;
    const early = getReadingScoreIncrement(1, READING_SCORE_EPOCH_MS);
    const late = getReadingScoreIncrement(1, READING_SCORE_EPOCH_MS + halfLifeMs);
    expect(early).toBe(1);
    expect(late).toBe(2);
  });

  it('weighs all usage on the same UTC day identically', () => {
    const dayStart = READING_SCORE_EPOCH_MS + DAY_MS * 3;
    const dayEnd = dayStart + DAY_MS - 1;
    expect(getReadingScoreIncrement(1, dayStart)).toBe(getReadingScoreIncrement(1, dayEnd));
    expect(getReadingScoreIncrement(1, dayStart + DAY_MS))
      .toBeGreaterThan(getReadingScoreIncrement(1, dayStart));
  });

  it('gives pre-epoch usage fractional weights', () => {
    const halfLifeMs = READING_SCORE_HALF_LIFE_DAYS * DAY_MS;
    expect(getReadingScoreIncrement(1, READING_SCORE_EPOCH_MS - halfLifeMs)).toBe(0.5);
  });

  it('scales linearly with usage time', () => {
    const t = READING_SCORE_EPOCH_MS + READING_SCORE_HALF_LIFE_DAYS * DAY_MS * 3;
    expect(getReadingScoreIncrement(5000, t)).toBe(5000 * getReadingScoreIncrement(1, t));
  });

  it('scores nothing for zero or malformed usage', () => {
    const t = READING_SCORE_EPOCH_MS;
    expect(getReadingScoreIncrement(0, t)).toBe(0);
    expect(getReadingScoreIncrement(-2, t)).toBe(0);
    expect(getReadingScoreIncrement(NaN, t)).toBe(0);
  });

  // An unbounded `occurredAt` (the schema only requires a positive int) would otherwise reach
  // the exponent and increment the stored score to Infinity, pinning that book to rank 1 with
  // no way back — a recompute reads the same bad timestamp.
  it('scores nothing for a timestamp that would overflow the score', () => {
    expect(getReadingScoreIncrement(1000, Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(getReadingScoreIncrement(1000, Infinity)).toBe(0);
    expect(getReadingScoreIncrement(1000, NaN)).toBe(0);
  });

  // What the backfill actually relies on: summing a day's deltas and scoring the total at that
  // day's UTC midnight equals scoring each delta at its own moment. Without this, a re-run
  // would silently re-rank the catalogue.
  it('scores a day of deltas the same whether summed first or scored individually', () => {
    const dayStartMs = READING_SCORE_EPOCH_MS + DAY_MS * 11;
    const deltas: Array<[number, number]> = [[500, 3], [700, 9], [34, 21]];
    const live = deltas.reduce(
      (sum, [usageMs, hour]) => sum
        + getReadingScoreIncrement(usageMs, dayStartMs + hour * 3600000),
      0,
    );
    const recomputed = getReadingScoreIncrement(500 + 700 + 34, dayStartMs);
    // Float addition isn't associative, so the two agree to precision rather than bit-for-bit.
    // The gap is ~1e-16 relative, orders of magnitude under any real rank gap — but it does
    // mean a backfill re-run rewrites every scored book instead of short-circuiting.
    expect(Math.abs(live - recomputed) / recomputed).toBeLessThan(1e-12);
  });
});
