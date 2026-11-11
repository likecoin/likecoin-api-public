import { describe, expect, it } from 'vitest';
import { ONE_DAY_IN_S } from '../../src/constant';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { makeTimestampFromMillis } from '../stub/firebase';
import axiosist from './axiosist';
import mockEVMAddress from './address';

const BASE_URL = '/api/likernft/book/store/search';

const TAIWAN_13 = '9786266531625';
const TAIWAN_HYPHEN = '978-626-653-162-5';
const TAIWAN_SPACE = '978 626 653 162 5';
const TAIWAN_10 = '6266531623';
const CANON_13 = '9780306406157';
const CANON_HYPHEN = '978-0-306-40615-7';
const CANON_10 = '0306406152';

const ISBN_CACHE = `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`;

const ID_BOOK = mockEVMAddress(0x70);
const ID_OTHER = mockEVMAddress(0x71);
const ID_OLDER = mockEVMAddress(0x72);
const ID_NEWER = mockEVMAddress(0x73);
const ID_HIDDEN = mockEVMAddress(0x74);
const ID_PENDING = mockEVMAddress(0x75);
const ID_REDIRECTED = mockEVMAddress(0x76);
const ID_UNLISTED = mockEVMAddress(0x77);
const ID_PARTIAL = mockEVMAddress(0x78);
const ID_ADULT = mockEVMAddress(0x79);

const get = (params: Record<string, string>) => axiosist
  .get(BASE_URL, { params })
  .catch((err: any) => err.response);

async function makeNFTBookStub(classId: string, overrides: Record<string, unknown> = {}) {
  await likeNFTBookCollection.doc(classId).set({
    classId,
    ownerWallet: 'wallet1',
    chain: 'base',
    prices: [{ priceInDecimal: 100, stock: 1 }],
    ...overrides,
  } as any);
}

describe('GET /likernft/book/store/search?isbn=', () => {
  it('finds a hyphenated listing from a compact ISBN and returns that isbn', async () => {
    await makeNFTBookStub(ID_BOOK, {
      isbn: TAIWAN_HYPHEN,
      name: 'Hyphenated',
      pendingNFTCount: 4,
    });
    await makeNFTBookStub(ID_OTHER, { isbn: CANON_13, name: 'Other' });

    const res = await get({ isbn: TAIWAN_13 });
    expect(res.status).toBe(200);
    expect(res.data.list).toHaveLength(1);
    expect(res.data.list[0].classId).toBe(ID_BOOK);
    expect(res.data.list[0].isbn).toBe(TAIWAN_HYPHEN);
    expect(res.data.list[0].name).toBe('Hyphenated');
    expect(res.data.list[0].pendingNFTCount).toBeUndefined();
    expect(res.headers['cache-control']).toBe(ISBN_CACHE);
  });

  it('finds a listing that stored the ISBN-13 label', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: `ISBN-13: ${TAIWAN_HYPHEN}` });

    const res = await get({ isbn: TAIWAN_13 });
    expect(res.status).toBe(200);
    expect(res.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
    expect(res.data.list[0].isbn).toBe(`ISBN-13: ${TAIWAN_HYPHEN}`);
  });

  it('does not treat a leading 13 as the ISBN-10 label', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: '1305504917' });

    const res = await get({ isbn: 'ISBN 1305504917' });
    expect(res.status).toBe(200);
    expect(res.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
  });

  it('finds a compact listing from a hyphenated, spaced or labelled ISBN', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: TAIWAN_13 });

    const hyphen = await get({ isbn: TAIWAN_HYPHEN });
    const spaced = await get({ isbn: TAIWAN_SPACE });
    const labelled = await get({ isbn: `ISBN: ${TAIWAN_HYPHEN}` });
    expect(hyphen.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
    expect(spaced.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
    expect(labelled.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
  });

  it('matches ISBN-10 and ISBN-13 in either direction', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: TAIWAN_HYPHEN });
    await makeNFTBookStub(ID_OTHER, { isbn: CANON_10 });

    const from10 = await get({ isbn: TAIWAN_10 });
    const from13 = await get({ isbn: CANON_HYPHEN });
    expect(from10.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
    expect(from13.data.list.map((book: any) => book.classId)).toEqual([ID_OTHER]);
  });

  it('finds a space-separated listing and ignores a check-digit typo', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: TAIWAN_SPACE });

    const hit = await get({ isbn: TAIWAN_13 });
    const miss = await get({ isbn: '9786266531626' });
    expect(hit.data.list.map((book: any) => book.classId)).toEqual([ID_BOOK]);
    expect(miss.status).toBe(200);
    expect(miss.data).toEqual({ list: [] });
    expect(miss.headers['cache-control']).toBe(ISBN_CACHE);
  });

  it('returns an empty list for an unknown or unrecognizable ISBN', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: TAIWAN_13 });

    const unknown = await get({ isbn: CANON_13 });
    const garbage = await get({ isbn: 'not-an-isbn' });
    expect(unknown.data).toEqual({ list: [] });
    expect(garbage.status).toBe(200);
    expect(garbage.data).toEqual({ list: [] });
    expect(garbage.headers['cache-control']).toBe(ISBN_CACHE);
  });

  it('returns at most the newest visible listing', async () => {
    await makeNFTBookStub(ID_OLDER, {
      isbn: TAIWAN_13,
      timestamp: makeTimestampFromMillis(100),
      name: 'Older',
    });
    await makeNFTBookStub(ID_NEWER, {
      isbn: TAIWAN_HYPHEN,
      timestamp: makeTimestampFromMillis(200),
      name: 'Newer',
    });

    const res = await get({ isbn: TAIWAN_10 });
    expect(res.data.list).toHaveLength(1);
    expect(res.data.list[0].classId).toBe(ID_NEWER);
  });

  it('prefers an older visible listing over a newer hidden duplicate', async () => {
    await makeNFTBookStub(ID_OLDER, { isbn: TAIWAN_13, timestamp: makeTimestampFromMillis(100) });
    await makeNFTBookStub(ID_NEWER, {
      isbn: TAIWAN_13,
      timestamp: makeTimestampFromMillis(300),
      isHidden: true,
    });

    const res = await get({ isbn: TAIWAN_HYPHEN });
    expect(res.data.list).toHaveLength(1);
    expect(res.data.list[0].classId).toBe(ID_OLDER);
  });

  it('omits hidden, pending-review, redirected and fully unlisted books', async () => {
    const unlisted = { priceInDecimal: 100, stock: 1, isUnlisted: true };
    await makeNFTBookStub(ID_HIDDEN, { isbn: TAIWAN_13, isHidden: true });
    await makeNFTBookStub(ID_PENDING, { isbn: CANON_13, isPendingReview: true });
    await makeNFTBookStub(ID_REDIRECTED, { isbn: CANON_10, redirectClassId: ID_BOOK });
    await makeNFTBookStub(ID_UNLISTED, { isbn: '9780804429573', prices: [unlisted, unlisted] });

    const hidden = await get({ isbn: TAIWAN_13 });
    const pending = await get({ isbn: CANON_HYPHEN });
    const redirected = await get({ isbn: '0-306-40615-2' });
    const allUnlisted = await get({ isbn: '978-0-8044-2957-3' });
    expect(hidden.data).toEqual({ list: [] });
    expect(pending.data).toEqual({ list: [] });
    expect(redirected.data).toEqual({ list: [] });
    expect(allUnlisted.data).toEqual({ list: [] });
  });

  it('keeps a partly unlisted book and an adult-only book', async () => {
    const listed = { priceInDecimal: 100, stock: 1, isUnlisted: false };
    const unlisted = { priceInDecimal: 100, stock: 1, isUnlisted: true };
    await makeNFTBookStub(ID_PARTIAL, { isbn: TAIWAN_13, prices: [unlisted, listed] });
    await makeNFTBookStub(ID_ADULT, { isbn: CANON_13, isAdultOnly: true });

    const partial = await get({ isbn: TAIWAN_13 });
    const adult = await get({ isbn: CANON_13 });
    expect(partial.data.list.map((book: any) => book.classId)).toEqual([ID_PARTIAL]);
    expect(adult.data.list.map((book: any) => book.classId)).toEqual([ID_ADULT]);
    expect(adult.data.list[0].isAdultOnly).toBe(true);
  });

  it('does not require q, and ignores q when isbn is set', async () => {
    await makeNFTBookStub(ID_BOOK, { isbn: TAIWAN_HYPHEN, name: 'From Firestore' });

    const isbnOnly = await get({ isbn: TAIWAN_13 });
    const both = await get({ isbn: TAIWAN_13, q: 'not-the-title' });
    expect(isbnOnly.status).toBe(200);
    expect(isbnOnly.data.list[0].classId).toBe(ID_BOOK);
    expect(both.data.list).toHaveLength(1);
    expect(both.data.list[0].name).toBe('From Firestore');
    expect(both.headers['cache-control']).toBe(ISBN_CACHE);
  });
});

describe('GET /likernft/book/store/search?q=', () => {
  it('still requires q and does not apply the ISBN cache', async () => {
    const missing = await get({});
    const blankISBN = await get({ isbn: '   ' });
    const byQ = await get({ q: TAIWAN_13 });

    expect(missing.status).toBe(400);
    expect(missing.data).toBe('INVALID_SEARCH_QUERY');
    expect(blankISBN.status).toBe(400);
    expect(byQ.status).toBe(200);
    expect(byQ.data).toEqual({ list: null });
    expect(byQ.headers['cache-control']).toBeUndefined();
  });
});
