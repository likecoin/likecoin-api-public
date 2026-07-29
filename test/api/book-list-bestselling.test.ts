import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection, Timestamp } from '../../src/util/firebase';

const LIST_PATH = '/api/likernft/book/store/list/bestselling';
const REFRESH_PATH = '/api/likernft/book/store/admin/bestselling-books/refresh';
// matches BESTSELLING_BOOKS_ADMIN_TOKEN in test/setup.ts
const AUTH = 'test-bestselling-books-admin-token';
const OWNER = mockEVMAddress(0x44);

// The stub firestore can't rank, page, or bound the 30-day window;
// this suite covers filtering, cursor validation, and the refresh counting rules.
const seedBook = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId, ownerWallet: OWNER, isPlusReadingEnabled: true, salesCount30d: 0, ...data,
  } as any);

const seedTx = (classId: string, paymentId: string, data: Record<string, unknown> = {}) => (
  likeNFTBookCollection
    .doc(classId)
    .collection('transactions')
    .doc(paymentId)
    .set({
      status: 'completed', timestamp: Timestamp.now(), quantity: 1, priceInDecimal: 900, ...data,
    } as any)
);

const get = (query = '') => axiosist
  .get(`${LIST_PATH}${query}`)
  .catch((err) => (err as any).response);

const refresh = (body: Record<string, unknown> = {}, token: string | null = AUTH) => axiosist
  .post(REFRESH_PATH, body, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  .catch((err) => (err as any).response);

const getBookData = async (classId: string) => {
  const snap = await likeNFTBookCollection.doc(classId).get();
  return snap.data() as any;
};

describe('GET /likernft/book/store/list/bestselling', () => {
  it('scopes to Plus-reading books with library=1', async () => {
    const inLibrary = mockEVMAddress(0xc1);
    const notInLibrary = mockEVMAddress(0xc2);
    await seedBook(inLibrary, { salesCount30d: 5 });
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

  it('does not leak the sales counter to clients', async () => {
    const classId = mockEVMAddress(0xc5);
    await seedBook(classId, { salesCount30d: 42 });

    const res = await get();
    const book = res.data.list.find((b: any) => b.classId === classId);
    expect(book).toBeDefined();
    // Rank order is public; the sales figures behind it are not.
    expect(book.salesCount30d).toBeUndefined();
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

describe('POST /likernft/book/store/admin/bestselling-books/refresh', () => {
  it('rejects requests without the admin token', async () => {
    const res = await refresh({}, null);
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong admin token', async () => {
    const res = await refresh({}, 'wrong-token');
    expect(res.status).toBe(401);
  });

  it('counts paid sales and skips unpaid and free transactions', async () => {
    const classId = mockEVMAddress(0xd1);
    await seedBook(classId, { lastSaleTimestamp: Timestamp.now() });
    await seedTx(classId, 'tx-paid', { status: 'paid' });
    await seedTx(classId, 'tx-completed', { status: 'completed', quantity: 2 });
    await seedTx(classId, 'tx-new', { status: 'new' });
    await seedTx(classId, 'tx-free', { status: 'completed', priceInDecimal: 0 });

    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.scanned).toBeGreaterThanOrEqual(1);
    // paid (1) + completed (2); `new` and free claims are excluded.
    expect((await getBookData(classId)).salesCount30d).toBe(3);
  });

  it('decays counts back to zero when no sale remains in the window', async () => {
    const classId = mockEVMAddress(0xd2);
    await seedBook(classId, { salesCount30d: 5 });

    const res = await refresh();
    expect(res.status).toBe(200);
    expect((await getBookData(classId)).salesCount30d).toBe(0);
  });

  it('seeds the field onto docs missing it only with seedMissing', async () => {
    const classId = mockEVMAddress(0xd3);
    await likeNFTBookCollection.doc(classId).set({ classId, ownerWallet: OWNER } as any);

    let res = await refresh();
    expect(res.status).toBe(200);
    expect(res.data.seeded).toBe(0);
    expect((await getBookData(classId)).salesCount30d).toBeUndefined();

    res = await refresh({ seedMissing: true });
    expect(res.status).toBe(200);
    expect(res.data.seeded).toBeGreaterThanOrEqual(1);
    expect((await getBookData(classId)).salesCount30d).toBe(0);
  });

  it('does not write with dryRun', async () => {
    const classId = mockEVMAddress(0xd4);
    await seedBook(classId, { salesCount30d: 5 });

    const res = await refresh({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.data.updated).toBeGreaterThanOrEqual(1);
    expect((await getBookData(classId)).salesCount30d).toBe(5);
  });
});
