import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x81);

// The settings endpoint's happy path ends in syncNFTBookInfoWithISCN, which reads live
// chain data, so only its validation layer is exercised here.
const seedBook = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
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

describe('book listing isLikerLandArt setting', () => {
  it('returns isLikerLandArt of a listing', async () => {
    const classId = mockEVMAddress(0x82);
    await seedBook(classId, { isLikerLandArt: true });

    const res = await axiosist.get(`${BASE_URL}/${classId}`);
    expect(res.status).toBe(200);
    expect(res.data.isLikerLandArt).toBe(true);
  });

  it('rejects switching isLikerLandArt back to false', async () => {
    const classId = mockEVMAddress(0x83);
    await seedBook(classId, { isLikerLandArt: true });

    expect((await postSettings(classId, { isLikerLandArt: false })).status).toBe(400);
    expect((await likeNFTBookCollection.doc(classId).get()).data()?.isLikerLandArt).toBe(true);
  });
});
