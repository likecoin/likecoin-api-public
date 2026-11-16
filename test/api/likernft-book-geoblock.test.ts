import {
  describe, it, expect, vi,
} from 'vitest';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  SLACK_COMMAND_TOKEN: 'slack-token',
  BOOK_ADMIN_ALLOWED_CHANNEL_IDS: ['C_ADMIN'],
  BOOK_ADMIN_ALLOWED_USER_IDS: ['U_ADMIN'],
}));

// eslint-disable-next-line import/first
import axiosist from './axiosist';

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x91);
const ownerHeaders = {
  Authorization: `Bearer ${jwtSign({ wallet: OWNER, permissions: ['read:nftbook', 'write:nftbook'] })}`,
};

const seedListing = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId, ownerWallet: OWNER, prices: [], ...data,
  } as any);

const getStored = async (classId: string) => (
  await likeNFTBookCollection.doc(classId).get()
).data();

const runSlackBookCommand = (text: string) => axiosist.post(
  '/api/slack/book',
  new URLSearchParams({
    token: 'slack-token', channel_id: 'C_ADMIN', user_id: 'U_ADMIN', text,
  }).toString(),
  { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
);

describe('Slack /book approve geoblock', () => {
  it('records admin as the source', async () => {
    const classId = mockEVMAddress(0x92);
    await seedListing(classId);

    const res = await runSlackBookCommand(`approve ${classId} geoblock HK,JP`);
    expect(res.data.text).toContain('geoblocked (HK, CN, JP)');

    const stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toEqual(['HK', 'CN', 'JP']);
    expect(stored?.restrictedTerritoriesSetBy).toBe('admin');
  });

  it('clears the source along with the territories', async () => {
    const classId = mockEVMAddress(0x93);
    await seedListing(classId, { restrictedTerritories: ['HK', 'CN'], restrictedTerritoriesSetBy: 'review' });

    const res = await runSlackBookCommand(`approve ${classId} clear_geoblock`);
    expect(res.data.text).toContain('geoblock_cleared');

    const stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toBeUndefined();
    expect(stored?.restrictedTerritoriesSetBy).toBeUndefined();
  });
});

describe('listing response', () => {
  it('returns the geoblock source to the owner only', async () => {
    const classId = mockEVMAddress(0x94);
    await seedListing(classId, { restrictedTerritories: ['HK', 'CN'], restrictedTerritoriesSetBy: 'review' });

    const ownerRes = await axiosist.get(`${BASE_URL}/${classId}`, { headers: ownerHeaders });
    expect(ownerRes.data.restrictedTerritories).toEqual(['HK', 'CN']);
    expect(ownerRes.data.restrictedTerritoriesSetBy).toBe('review');

    const publicRes = await axiosist.get(`${BASE_URL}/${classId}`);
    expect(publicRes.data.restrictedTerritories).toEqual(['HK', 'CN']);
    expect(publicRes.data.restrictedTerritoriesSetBy).toBeUndefined();
  });
});
