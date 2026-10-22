import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x91);

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

describe('book listing hasAIGeneratedContent setting', () => {
  it('returns hasAIGeneratedContent of a listing', async () => {
    const classId = mockEVMAddress(0x92);
    await seedBook(classId, { hasAIGeneratedContent: true });

    const res = await axiosist.get(`${BASE_URL}/${classId}`);
    expect(res.status).toBe(200);
    expect(res.data.hasAIGeneratedContent).toBe(true);
  });

  it('rejects a non-boolean hasAIGeneratedContent', async () => {
    const classId = mockEVMAddress(0x93);
    await seedBook(classId, { hasAIGeneratedContent: true });

    expect((await postSettings(classId, { hasAIGeneratedContent: 'yes' })).status).toBe(400);
    const stored = (await likeNFTBookCollection.doc(classId).get()).data();
    expect(stored?.hasAIGeneratedContent).toBe(true);
  });
});
