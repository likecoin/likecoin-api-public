import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';

const { reviewBookListingContent } = vi.hoisted(() => ({ reviewBookListingContent: vi.fn() }));

vi.mock('../../src/util/api/likernft/book/complianceReview', async (importOriginal) => ({
  ...(await importOriginal() as object),
  reviewBookListingContent,
}));

vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  SLACK_COMMAND_TOKEN: 'slack-token',
  BOOK_ADMIN_ALLOWED_CHANNEL_IDS: ['C_ADMIN'],
  BOOK_ADMIN_ALLOWED_USER_IDS: ['U_ADMIN'],
}));

// eslint-disable-next-line import/first
import axiosist from './axiosist';
// eslint-disable-next-line import/first
import { newNftBookInfo } from '../../src/util/api/likernft/book';
// eslint-disable-next-line import/first
import { NewListingBodySchema } from '../../src/util/api/likernft/book/schemas';

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

const postSettings = (classId: string, payload: Record<string, unknown>) => axiosist
  .post(`${BASE_URL}/${classId}/settings`, payload, { headers: ownerHeaders })
  .catch((err) => (err as any).response);

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

describe('publisher restrictedTerritories', () => {
  beforeEach(() => {
    reviewBookListingContent.mockReset();
    reviewBookListingContent.mockResolvedValue({ status: 'skipped' });
  });

  it('accepts valid codes, uppercasing them and expanding HK', () => {
    expect(NewListingBodySchema.shape.restrictedTerritories.parse(['hk', 'JP', 'CN']))
      .toEqual(['HK', 'CN', 'JP']);
  });

  it('rejects an invalid code', async () => {
    const classId = mockEVMAddress(0x95);
    await seedListing(classId);

    const res = await postSettings(classId, { restrictedTerritories: ['HK', 'UK'] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.data)).toContain('INVALID_TERRITORY_CODE');
    expect((await getStored(classId))?.restrictedTerritories).toBeUndefined();
  });

  it('records the publisher as source on a new listing', async () => {
    const classId = mockEVMAddress(0x96);
    await newNftBookInfo(classId, { ownerWallet: OWNER, prices: [], restrictedTerritories: ['JP'] });

    const stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toEqual(['JP']);
    expect(stored?.restrictedTerritoriesSetBy).toBe('publisher');
  });

  it('leaves a new listing without territories unrestricted', async () => {
    const classId = mockEVMAddress(0x97);
    await newNftBookInfo(classId, { ownerWallet: OWNER, prices: [], restrictedTerritories: [] });

    const stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toBeUndefined();
    expect(stored?.restrictedTerritoriesSetBy).toBeUndefined();
  });

  it('adds a review geoblock to the publisher territories and locks them', async () => {
    reviewBookListingContent.mockResolvedValue({
      status: 'completed',
      verdict: { action: 'geoblock_hk' },
      model: 'test-model',
    });
    const classId = mockEVMAddress(0x98);
    await newNftBookInfo(classId, { ownerWallet: OWNER, prices: [], restrictedTerritories: ['JP'] });

    const stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toEqual(['JP', 'HK', 'CN']);
    expect(stored?.restrictedTerritoriesSetBy).toBe('review');
  });

  it('lets the publisher update and clear its own geoblock', async () => {
    const classId = mockEVMAddress(0x99);
    await seedListing(classId, { restrictedTerritories: ['JP'], restrictedTerritoriesSetBy: 'publisher' });

    expect((await postSettings(classId, { restrictedTerritories: ['HK'] })).status).toBe(200);
    let stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toEqual(['HK', 'CN']);
    expect(stored?.restrictedTerritoriesSetBy).toBe('publisher');

    expect((await postSettings(classId, { restrictedTerritories: [] })).status).toBe(200);
    stored = await getStored(classId);
    expect(stored?.restrictedTerritories).toBeUndefined();
    expect(stored?.restrictedTerritoriesSetBy).toBeUndefined();
  });

  it('leaves the geoblock alone when the request omits it', async () => {
    const classId = mockEVMAddress(0x9a);
    await seedListing(classId, { restrictedTerritories: ['JP'], restrictedTerritoriesSetBy: 'publisher' });

    expect((await postSettings(classId, { hideDownload: true })).status).toBe(200);
    expect((await getStored(classId))?.restrictedTerritories).toEqual(['JP']);
  });

  it.each([
    ['review', { restrictedTerritoriesSetBy: 'review' }],
    ['admin', { restrictedTerritoriesSetBy: 'admin' }],
    ['a source predating the field', {}],
  ])('rejects changes to a geoblock set by %s', async (_, source) => {
    const classId = mockEVMAddress(0x9b);
    await seedListing(classId, { restrictedTerritories: ['HK', 'CN'], ...source });

    for (const restrictedTerritories of [[], ['JP'], ['HK', 'JP']]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await postSettings(classId, { restrictedTerritories });
      expect(res.status).toBe(403);
      expect(res.data).toContain('RESTRICTED_TERRITORIES_LOCKED');
    }
    expect((await getStored(classId))?.restrictedTerritories).toEqual(['HK', 'CN']);
  });

  it('accepts an unchanged locked geoblock echoed back with other settings', async () => {
    const classId = mockEVMAddress(0x9c);
    await seedListing(classId, { restrictedTerritories: ['HK', 'CN'], restrictedTerritoriesSetBy: 'review' });

    const res = await postSettings(classId, { restrictedTerritories: ['CN', 'HK'], hideDownload: true });
    expect(res.status).toBe(200);

    const stored = await getStored(classId);
    expect(stored?.hideDownload).toBe(true);
    expect(stored?.restrictedTerritories).toEqual(['HK', 'CN']);
    expect(stored?.restrictedTerritoriesSetBy).toBe('review');
  });
});
