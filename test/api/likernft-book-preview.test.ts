import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x71);

// The settings endpoint's happy path ends in syncNFTBookInfoWithISCN, which reads live
// chain data, so only its validation layer is exercised here. Persistence -> filtered
// response is covered by seeding the listing directly.
const seedBook = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId, ownerWallet: OWNER, prices: [], ...data,
  } as any);

const getBook = (classId: string) => axiosist
  .get(`${BASE_URL}/${classId}`)
  .catch((err) => (err as any).response);

const postSettings = (classId: string, payload: Record<string, unknown>) => axiosist
  .post(`${BASE_URL}/${classId}/settings`, payload, {
    headers: {
      Authorization: `Bearer ${jwtSign({ wallet: OWNER, permissions: ['read:nftbook', 'write:nftbook'] })}`,
    },
  })
  .catch((err) => (err as any).response);

describe('book listing preview settings', () => {
  it('returns the preview toggle and percentage of a listing', async () => {
    const classId = mockEVMAddress(0x72);
    await seedBook(classId, { isPreviewEnabled: true, previewPercentage: 20 });

    const res = await getBook(classId);
    expect(res.status).toBe(200);
    expect(res.data.isPreviewEnabled).toBe(true);
    expect(res.data.previewPercentage).toBe(20);
  });

  it('defaults isPreviewEnabled to false on listings predating the field', async () => {
    const classId = mockEVMAddress(0x73);
    await seedBook(classId);

    const res = await getBook(classId);
    expect(res.status).toBe(200);
    expect(res.data.isPreviewEnabled).toBe(false);
    expect(res.data.previewPercentage).toBeUndefined();
  });

  it('rejects a previewPercentage outside 1-50', async () => {
    const classId = mockEVMAddress(0x74);
    await seedBook(classId);

    expect((await postSettings(classId, { previewPercentage: 0 })).status).toBe(400);
    expect((await postSettings(classId, { previewPercentage: 80 })).status).toBe(400);
    expect((await postSettings(classId, { previewPercentage: 12.5 })).status).toBe(400);
  });
});
