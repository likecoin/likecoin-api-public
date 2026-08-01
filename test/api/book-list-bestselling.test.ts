import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection } from '../../src/util/firebase';
import {
  SALES_SCORE_EPOCH_MS,
  SALES_SCORE_HALF_LIFE_DAYS,
  getSaleScoreIncrement,
} from '../../src/util/api/likernft/book/sales';

const DAY_MS = 24 * 60 * 60 * 1000;

const LIST_PATH = '/api/likernft/book/store/list/bestselling';
const OWNER = mockEVMAddress(0x44);

// The stub firestore can't rank or page; this suite covers filtering, cursor
// validation, and the score math that feeds the purchase-time increment.
const seedBook = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId,
    ownerWallet: OWNER,
    isPlusReadingEnabled: true,
    salesScore: 0,
    ...data,
  } as any);

const get = (query = '') => axiosist
  .get(`${LIST_PATH}${query}`)
  .catch((err) => (err as any).response);

describe('GET /likernft/book/store/list/bestselling', () => {
  it('scopes to Plus-reading books with library=1', async () => {
    const inLibrary = mockEVMAddress(0xc1);
    const notInLibrary = mockEVMAddress(0xc2);
    await seedBook(inLibrary, { salesScore: 5 });
    await seedBook(notInLibrary, { isPlusReadingEnabled: false });

    const res = await get('?library=1');
    expect(res.status).toBe(200);
    const classIds = res.data.list.map((b: any) => b.classId);
    expect(classIds).toContain(inLibrary);
    expect(classIds).not.toContain(notInLibrary);
  });

  it('lists the whole catalogue without library=1', async () => {
    const inLibrary = mockEVMAddress(0xc3);
    const notInLibrary = mockEVMAddress(0xc4);
    await seedBook(inLibrary);
    await seedBook(notInLibrary, { isPlusReadingEnabled: false });

    const res = await get();
    expect(res.status).toBe(200);
    const classIds = res.data.list.map((b: any) => b.classId);
    expect(classIds).toContain(inLibrary);
    expect(classIds).toContain(notInLibrary);
  });

  it('does not leak the sales score to clients', async () => {
    const classId = mockEVMAddress(0xc5);
    await seedBook(classId, { salesScore: 42 });

    const res = await get();
    const book = res.data.list.find((b: any) => b.classId === classId);
    expect(book).toBeDefined();
    // Rank order is public; the sales figures behind it are not.
    expect(book.salesScore).toBeUndefined();
  });

  it('excludes hidden and redirected books from the list', async () => {
    const visible = mockEVMAddress(0xc6);
    const hidden = mockEVMAddress(0xc7);
    const redirected = mockEVMAddress(0xc8);
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
    await seedBook(mockEVMAddress(0xc9));

    const res = await get('?limit=100');
    expect(res.status).toBe(200);
    expect(res.data.nextKey).toBeNull();
  });

  it('rejects a cursor that names no book', async () => {
    const res = await get(`?key=${mockEVMAddress(0xcc)}`);
    expect(res.status).toBe(400);
  });

  it('accepts a mixed-case class id as the cursor', async () => {
    // Books are keyed by lowercase class id; an EIP-55 checksummed cursor must still resolve.
    const mixedCaseClassId = '0xAbCdEf9999999999999999999999999999999999';
    await seedBook(mixedCaseClassId.toLowerCase());

    const res = await get(`?key=${mixedCaseClassId}`);
    expect(res.status).toBe(200);
  });
});

describe('getSaleScoreIncrement', () => {
  it('weighs a sale one half-life later exactly twice as much', () => {
    const halfLifeMs = SALES_SCORE_HALF_LIFE_DAYS * DAY_MS;
    const early = getSaleScoreIncrement(1, SALES_SCORE_EPOCH_MS);
    const late = getSaleScoreIncrement(1, SALES_SCORE_EPOCH_MS + halfLifeMs);
    expect(early).toBe(1);
    expect(late).toBe(2);
  });

  it('weighs all sales on the same UTC day identically', () => {
    const dayStart = SALES_SCORE_EPOCH_MS + DAY_MS * 3;
    const dayEnd = dayStart + DAY_MS - 1;
    expect(getSaleScoreIncrement(1, dayStart)).toBe(getSaleScoreIncrement(1, dayEnd));
    expect(getSaleScoreIncrement(1, dayStart + DAY_MS))
      .toBeGreaterThan(getSaleScoreIncrement(1, dayStart));
  });

  it('gives pre-epoch sales fractional weights', () => {
    const halfLifeMs = SALES_SCORE_HALF_LIFE_DAYS * DAY_MS;
    expect(getSaleScoreIncrement(1, SALES_SCORE_EPOCH_MS - halfLifeMs)).toBe(0.5);
  });

  it('scales linearly with quantity', () => {
    const t = SALES_SCORE_EPOCH_MS + SALES_SCORE_HALF_LIFE_DAYS * DAY_MS * 3;
    expect(getSaleScoreIncrement(5, t)).toBe(5 * getSaleScoreIncrement(1, t));
  });

  it('counts a malformed quantity as one sale', () => {
    const t = SALES_SCORE_EPOCH_MS;
    expect(getSaleScoreIncrement(0, t)).toBe(1);
    expect(getSaleScoreIncrement(-2, t)).toBe(1);
    expect(getSaleScoreIncrement(NaN, t)).toBe(1);
  });
});
