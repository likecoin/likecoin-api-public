import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';

const ID_DRM_FREE = mockEVMAddress(0x20);
const ID_DRM_HIDDEN = mockEVMAddress(0x21);
const ID_DEFAULT = mockEVMAddress(0x22);
const ID_VISIBLE = mockEVMAddress(0x30);
const ID_HIDDEN = mockEVMAddress(0x31);
const ID_REDIRECTED = mockEVMAddress(0x32);
const ID_FREE = mockEVMAddress(0x40);
const ID_PAID = mockEVMAddress(0x41);
const ID_NO_MIN_FIELD = mockEVMAddress(0x42);
const ID_SINGLE_FETCH = mockEVMAddress(0x43);
const ID_ALL_UNLISTED = mockEVMAddress(0x50);
const ID_PARTLY_UNLISTED = mockEVMAddress(0x51);

const get = (path: string) => axiosist
  .get(path)
  .catch((err: any) => err.response);

async function makeNFTBookStub(classId: string, overrides: Record<string, unknown> = {}) {
  await likeNFTBookCollection.doc(classId).set({
    classId,
    ownerWallet: 'wallet1',
    // `/list` defaults the chain query to 'base', and Firestore equality
    // filters skip docs missing the field — stub it so fixtures aren't dropped.
    chain: 'base',
    prices: [],
    ...overrides,
  } as any);
}

describe('GET /list/drm-free', () => {
  it('returns only books where hideDownload === false', async () => {
    await makeNFTBookStub(ID_DRM_FREE, { hideDownload: false });
    await makeNFTBookStub(ID_DRM_HIDDEN, { hideDownload: true });
    // Books with no hideDownload field are excluded:
    // the query `where('hideDownload','==',false)` skips absent-field docs.
    await makeNFTBookStub(ID_DEFAULT);

    const res = await get(`${BASE_URL}/list/drm-free?limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_DRM_FREE);
    expect(ids).not.toContain(ID_DRM_HIDDEN);
    expect(ids).not.toContain(ID_DEFAULT);
    expect(res.data).toHaveProperty('nextKey');
  });

  it('excludes hidden and redirected books from the response', async () => {
    await makeNFTBookStub(ID_VISIBLE, { hideDownload: false });
    await makeNFTBookStub(ID_HIDDEN, { hideDownload: false, isHidden: true });
    await makeNFTBookStub(ID_REDIRECTED, { hideDownload: false, redirectClassId: ID_VISIBLE });

    const res = await get(`${BASE_URL}/list/drm-free?limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_VISIBLE);
    expect(ids).not.toContain(ID_HIDDEN);
    expect(ids).not.toContain(ID_REDIRECTED);
  });
});

describe('GET /list/free', () => {
  it('returns only books where minPriceInDecimal === 0', async () => {
    await makeNFTBookStub(ID_FREE, { minPriceInDecimal: 0 });
    await makeNFTBookStub(ID_PAID, { minPriceInDecimal: 100 });
    // Books with no minPriceInDecimal field are excluded:
    // the query `where('minPriceInDecimal','==',0)` skips absent-field docs.
    await makeNFTBookStub(ID_NO_MIN_FIELD);

    const res = await get(`${BASE_URL}/list/free?limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_FREE);
    expect(ids).not.toContain(ID_PAID);
    expect(ids).not.toContain(ID_NO_MIN_FIELD);
  });
});

describe('minPrice exposure on filtered listing', () => {
  it('GET /list carries minPrice (dollars) per item, omits it when absent', async () => {
    await makeNFTBookStub(ID_FREE, { minPriceInDecimal: 0 });
    await makeNFTBookStub(ID_PAID, { minPriceInDecimal: 250 });
    await makeNFTBookStub(ID_NO_MIN_FIELD);

    const res = await get(`${BASE_URL}/list?limit=100`);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.data.list.map((b: any) => [b.classId, b]));
    expect(byId[ID_FREE]?.minPrice).toBe(0);
    expect(byId[ID_PAID]?.minPrice).toBe(2.5);
    expect(byId[ID_NO_MIN_FIELD]).toBeDefined();
    expect(byId[ID_NO_MIN_FIELD].minPrice).toBeUndefined();
  });

  it('GET /:classId carries minPrice', async () => {
    await makeNFTBookStub(ID_SINGLE_FETCH, { minPriceInDecimal: 250 });
    const res = await get(`${BASE_URL}/${ID_SINGLE_FETCH}`);
    expect(res.status).toBe(200);
    expect(res.data.minPrice).toBe(2.5);
  });
});

describe('unlisted books in the listings', () => {
  const LISTED = { priceInDecimal: 100, stock: 1, isUnlisted: false };
  const UNLISTED = { priceInDecimal: 100, stock: 1, isUnlisted: true };

  it('drops a book whose every edition is unlisted, keeps a partly unlisted one', async () => {
    await makeNFTBookStub(ID_ALL_UNLISTED, { prices: [UNLISTED, UNLISTED] });
    await makeNFTBookStub(ID_PARTLY_UNLISTED, { prices: [UNLISTED, LISTED] });

    const res = await get(`${BASE_URL}/list?limit=100`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).not.toContain(ID_ALL_UNLISTED);
    expect(ids).toContain(ID_PARTLY_UNLISTED);
  });

  // The class endpoint is deliberately exempt: a purchase link or QR code to a
  // hidden edition has to keep working.
  it('still serves an all-unlisted book from the class endpoint', async () => {
    await makeNFTBookStub(ID_ALL_UNLISTED, { prices: [UNLISTED] });
    const res = await get(`${BASE_URL}/${ID_ALL_UNLISTED}`);
    expect(res.status).toBe(200);
    expect(res.data.classId).toBe(ID_ALL_UNLISTED);
  });

  it('reports borrowing and preview off for an all-unlisted book', async () => {
    await makeNFTBookStub(ID_ALL_UNLISTED, {
      prices: [UNLISTED],
      isPlusReadingEnabled: true,
      isPreviewEnabled: true,
    });
    const res = await get(`${BASE_URL}/${ID_ALL_UNLISTED}`);
    expect(res.status).toBe(200);
    expect(res.data.isPlusReadingEnabled).toBe(false);
    expect(res.data.isPreviewEnabled).toBe(false);
  });
});

describe('non-book goods in the listings', () => {
  const ID_BOOK = mockEVMAddress(0x60);
  const ID_GOODS = mockEVMAddress(0x61);
  const LISTED = { priceInDecimal: 100, stock: 1 };

  async function stubBookAndGoods(overrides: Record<string, unknown> = {}) {
    await makeNFTBookStub(ID_BOOK, { prices: [LISTED], ...overrides });
    await makeNFTBookStub(ID_GOODS, {
      prices: [LISTED],
      productType: 'goods',
      availableTerritories: ['HK'],
      ...overrides,
    });
  }

  it('GET /list returns books only by default, unchanged for books', async () => {
    await stubBookAndGoods();
    const res = await get(`${BASE_URL}/list?limit=100`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_BOOK);
    expect(ids).not.toContain(ID_GOODS);
  });

  it('GET /list serves goods only when asked for them', async () => {
    await stubBookAndGoods();
    const goodsRes = await get(`${BASE_URL}/list?limit=100&productType=goods`);
    const goodsIds = goodsRes.data.list.map((b: any) => b.classId);
    expect(goodsIds).toContain(ID_GOODS);
    expect(goodsIds).not.toContain(ID_BOOK);
    const goods = goodsRes.data.list.find((b: any) => b.classId === ID_GOODS);
    expect(goods.productType).toBe('goods');
    expect(goods.availableTerritories).toEqual(['HK']);

    const allRes = await get(`${BASE_URL}/list?limit=100&productType=all`);
    const allIds = allRes.data.list.map((b: any) => b.classId);
    expect(allIds).toEqual(expect.arrayContaining([ID_BOOK, ID_GOODS]));
  });

  it('falls back to books on an unknown productType rather than erroring', async () => {
    await stubBookAndGoods();
    const res = await get(`${BASE_URL}/list?limit=100&productType=shoes`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_BOOK);
    expect(ids).not.toContain(ID_GOODS);
  });

  it('keeps goods out of the derived /list/drm-free feed', async () => {
    await stubBookAndGoods({ hideDownload: false });
    const res = await get(`${BASE_URL}/list/drm-free?limit=100`);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_BOOK);
    expect(ids).not.toContain(ID_GOODS);
  });
});
