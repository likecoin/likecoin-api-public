import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x81);

// Seeded without Stripe ids, so the product sync after an update has nothing to call.
const seedListing = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId, ownerWallet: OWNER, prices: [], ...data,
  } as any);

const postSettings = (classId: string, payload: Record<string, unknown>) => axiosist
  .post(`${BASE_URL}/${classId}/settings`, payload, {
    headers: {
      Authorization: `Bearer ${jwtSign({ wallet: OWNER, permissions: ['read:nftbook', 'write:nftbook'] })}`,
    },
  })
  .catch((err) => (err as any).response);

describe('merch listing settings', () => {
  it('updates the presentational fields of a merch listing', async () => {
    const classId = '0xmerchsettings1';
    await seedListing(classId, { productType: 'merch', name: 'Old name' });

    const res = await postSettings(classId, {
      name: 'New name',
      description: 'New description',
      thumbnailUrl: 'https://example.com/thumb.webp',
      image: 'https://example.com/image.webp',
      promotionalImages: ['https://example.com/1.webp', 'https://example.com/2.webp'],
      maxQuantityPerOrder: 2,
    });
    expect(res.status).toBe(200);

    const stored = (await likeNFTBookCollection.doc(classId).get()).data();
    expect(stored?.name).toBe('New name');
    expect(stored?.description).toBe('New description');
    expect(stored?.thumbnailUrl).toBe('https://example.com/thumb.webp');
    expect(stored?.image).toBe('https://example.com/image.webp');
    expect(stored?.promotionalImages).toEqual(['https://example.com/1.webp', 'https://example.com/2.webp']);
    expect(stored?.maxQuantityPerOrder).toBe(2);
  });

  it('leaves fields it was not given untouched', async () => {
    const classId = '0xmerchsettings2';
    await seedListing(classId, { productType: 'merch', name: 'Keep me', promotionalImages: ['a'] });

    const res = await postSettings(classId, { description: 'Only this' });
    expect(res.status).toBe(200);

    const stored = (await likeNFTBookCollection.doc(classId).get()).data();
    expect(stored?.name).toBe('Keep me');
    expect(stored?.promotionalImages).toEqual(['a']);
    expect(stored?.description).toBe('Only this');
  });

  it('rejects these fields on a book, whose metadata lives on chain', async () => {
    const classId = mockEVMAddress(0x82);
    await seedListing(classId);

    const res = await postSettings(classId, { name: 'Renamed' });
    expect(res.status).toBe(400);
    expect(res.data).toContain('MERCH_ONLY_FIELDS');
    expect((await likeNFTBookCollection.doc(classId).get()).data()?.name).toBeUndefined();
  });

  it('rejects a maxQuantityPerOrder below 1', async () => {
    const classId = '0xmerchsettings3';
    await seedListing(classId, { productType: 'merch' });

    expect((await postSettings(classId, { maxQuantityPerOrder: 0 })).status).toBe(400);
  });
});
