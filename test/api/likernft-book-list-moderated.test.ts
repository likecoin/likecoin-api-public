import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { makeTimestampFromMillis as ts } from '../stub/firebase';
// eslint-disable-next-line import/no-relative-packages
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../config/config';

const BASE_URL = '/api/likernft/book/store';
const MODERATOR = mockEVMAddress(0x90);
const GLOBAL_MODERATOR = mockEVMAddress(0x91);
const ID_MODERATED = mockEVMAddress(0x92);
const ID_OTHER = mockEVMAddress(0x93);

const getModerated = (wallet: string, query = '') => axiosist
  .get(`${BASE_URL}/list/moderated?wallet=${wallet}&chain=base${query}`, {
    headers: {
      Authorization: `Bearer ${jwtSign({ wallet, permissions: ['read:nftbook'] })}`,
    },
  })
  .catch((err) => (err as any).response);

async function seedBooks() {
  await likeNFTBookCollection.doc(ID_MODERATED).set({
    classId: ID_MODERATED,
    ownerWallet: 'wallet1',
    chain: 'base',
    prices: [],
    moderatorWallets: [MODERATOR],
    timestamp: ts(2000),
  } as any);
  await likeNFTBookCollection.doc(ID_OTHER).set({
    classId: ID_OTHER,
    ownerWallet: 'wallet1',
    chain: 'base',
    prices: [],
    timestamp: ts(1000),
  } as any);
}

describe('GET /list/moderated', () => {
  beforeAll(() => {
    LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.push(GLOBAL_MODERATOR);
  });

  afterAll(() => {
    LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.splice(
      LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.indexOf(GLOBAL_MODERATOR),
      1,
    );
  });

  it('lists only books a moderator is assigned to, without a next page', async () => {
    await seedBooks();
    const res = await getModerated(MODERATOR, '&limit=1');
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_MODERATED);
    expect(ids).not.toContain(ID_OTHER);
    expect(res.data.nextKey).toBeNull();
  });

  it('lists every book for a global moderator and returns the timestamp cursor', async () => {
    await seedBooks();
    const res = await getModerated(GLOBAL_MODERATOR, '&limit=1');
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_MODERATED);
    expect(ids).toContain(ID_OTHER);
    // The stub ignores `limit` and ordering, so the cursor is the last seeded book.
    expect(res.data.nextKey).toBe(1000);
  });

  it('queries a global moderator page newest-first from the key', async () => {
    // The stub ignores ordering, limit and cursors, so assert on the query built instead.
    const calls: unknown[][] = [];
    const query: any = {
      where: (...args: unknown[]) => { calls.push(['where', ...args]); return query; },
      startAfter: (cursor: any) => { calls.push(['startAfter', cursor.toMillis()]); return query; },
      limit: (n: number) => { calls.push(['limit', n]); return query; },
      get: async () => ({ docs: [] }),
    };
    const spy = vi.spyOn(likeNFTBookCollection, 'orderBy').mockImplementation((...args: unknown[]) => {
      calls.push(['orderBy', ...args]);
      return query;
    });
    const res = await getModerated(GLOBAL_MODERATOR, '&limit=20&key=1500');
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      ['orderBy', 'timestamp', 'desc'],
      ['where', 'chain', '==', 'base'],
      ['startAfter', 1500],
      ['limit', 20],
    ]);
    expect(res.data.nextKey).toBeNull();
  });

  it('ends pagination when a global moderator page is not full', async () => {
    await seedBooks();
    const res = await getModerated(GLOBAL_MODERATOR, '&limit=100');
    expect(res.status).toBe(200);
    expect(res.data.nextKey).toBeNull();
  });

  it('includes name, productType and pendingShipmentCount', async () => {
    await likeNFTBookCollection.doc(ID_MODERATED).set({
      classId: ID_MODERATED,
      ownerWallet: 'wallet1',
      chain: 'base',
      prices: [],
      moderatorWallets: [MODERATOR],
      name: 'Merch item',
      productType: 'merch',
      pendingShipmentCount: 3,
    } as any);
    const res = await getModerated(MODERATOR);
    expect(res.status).toBe(200);
    const item = res.data.list.find((b: any) => b.classId === ID_MODERATED);
    expect(item).toMatchObject({ name: 'Merch item', productType: 'merch', pendingShipmentCount: 3 });
  });

  it('rejects a request without wallet', async () => {
    const res = await axiosist
      .get(`${BASE_URL}/list/moderated`, {
        headers: {
          Authorization: `Bearer ${jwtSign({ wallet: MODERATOR, permissions: ['read:nftbook'] })}`,
        },
      })
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);
  });
});
