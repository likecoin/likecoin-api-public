import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { getNFTClassDataById } from '../../src/util/evm/nft';
import { updateAirtablePublicationRecord } from '../../src/util/airtable';
import { NewListingBodySchema } from '../../src/util/api/likernft/book/schemas';

vi.mock('../../src/util/evm/nft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/util/evm/nft')>()),
  getNFTClassDataById: vi.fn(),
}));
vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/util/airtable')>()),
  updateAirtablePublicationRecord: vi.fn(),
}));

const mockGetNFTClassData = vi.mocked(getNFTClassDataById);
const mockUpdateAirtable = vi.mocked(updateAirtablePublicationRecord);

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0xa1);
const MODERATOR = mockEVMAddress(0xa2);
const STRANGER = mockEVMAddress(0xa3);
const CHAIN_METADATA = {
  name: 'Chain Name',
  genre: 'History',
  keywords: 'chain,old',
  recordTimestamp: '2026-01-01T00:00:00.000Z',
};

const seedListing = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId,
    ownerWallet: OWNER,
    moderatorWallets: [MODERATOR],
    prices: [],
    genre: 'History',
    keywords: ['chain', 'old'],
    ...data,
  } as any);

const getStored = async (classId: string) => (
  await likeNFTBookCollection.doc(classId).get()
).data();

const authHeaders = (wallet: string) => ({
  Authorization: `Bearer ${jwtSign({ wallet, permissions: ['read:nftbook', 'write:nftbook'] })}`,
});

const postSettings = (
  classId: string,
  payload: Record<string, unknown>,
  wallet = MODERATOR,
) => axiosist
  .post(`${BASE_URL}/${classId}/settings`, payload, { headers: authHeaders(wallet) })
  .catch((err) => (err as any).response);

const postRefresh = (classId: string) => axiosist
  .post(`${BASE_URL}/class/${classId}/refresh`, {}, { headers: authHeaders(OWNER) })
  .catch((err) => (err as any).response);

const setChainMetadata = (metadata: Record<string, unknown>) => {
  mockGetNFTClassData.mockResolvedValue(metadata as any);
};

describe('listing settings genre and keywords', () => {
  beforeEach(() => {
    mockGetNFTClassData.mockReset();
    mockUpdateAirtable.mockReset();
    setChainMetadata(CHAIN_METADATA);
  });

  it('lets a moderator write them, kept over chain by the sync that follows', async () => {
    const classId = mockEVMAddress(0xb1);
    await seedListing(classId);

    const res = await postSettings(classId, {
      genre: 'Fiction',
      keywords: [' 武俠 ', '小說', '', '武俠'],
    });
    expect(res.status).toBe(200);

    const stored = await getStored(classId);
    expect(stored?.genre).toBe('Fiction');
    expect(stored?.keywords).toEqual(['武俠', '小說']);
    expect(stored?.pendingMetadataFields).toEqual(['genre', 'keywords']);
    expect(stored?.pendingMetadataUpdatedAt?.toMillis()).toBeGreaterThan(Date.now() - 60_000);
    expect(mockUpdateAirtable).toHaveBeenLastCalledWith(expect.objectContaining({
      genre: 'Fiction', keywords: ['武俠', '小說'],
    }));
  });

  it('clears keywords with an empty list, in Airtable too', async () => {
    const classId = mockEVMAddress(0xb6);
    await seedListing(classId);

    const res = await postSettings(classId, { keywords: [' '] });
    expect(res.status).toBe(200);

    const stored = await getStored(classId);
    expect(stored?.keywords).toBeUndefined();
    expect(stored?.pendingMetadataFields).toEqual(['keywords']);
    expect(mockUpdateAirtable).toHaveBeenLastCalledWith(expect.objectContaining({
      genre: 'History', keywords: null,
    }));
  });

  it('lets the owner write them', async () => {
    const classId = mockEVMAddress(0xb2);
    await seedListing(classId);

    const res = await postSettings(classId, { genre: 'Poetry' }, OWNER);
    expect(res.status).toBe(200);

    const stored = await getStored(classId);
    expect(stored?.genre).toBe('Poetry');
    expect(stored?.keywords).toEqual(['chain', 'old']);
    expect(stored?.pendingMetadataFields).toEqual(['genre']);
  });

  it('rejects a wallet that is neither owner nor moderator', async () => {
    const classId = mockEVMAddress(0xb3);
    await seedListing(classId);

    const res = await postSettings(classId, { genre: 'Fiction' }, STRANGER);
    expect(res.status).toBe(403);
    expect((await getStored(classId))?.genre).toBe('History');
  });

  it('rejects a genre outside the book categories', async () => {
    const classId = mockEVMAddress(0xb4);
    await seedListing(classId);

    const res = await postSettings(classId, { genre: 'Wuxia' });
    expect(res.status).toBe(400);
    expect((await getStored(classId))?.pendingMetadataFields).toBeUndefined();
  });

  it('rejects more keywords than publish allows, counted after dedupe', async () => {
    const classId = mockEVMAddress(0xb5);
    await seedListing(classId);
    const keywords = Array.from({ length: 21 }, (_, i) => `k${i}`);

    const tooMany = await postSettings(classId, { keywords });
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(tooMany.data)).toContain('TOO_MANY_KEYWORDS');

    const deduped = await postSettings(classId, { keywords: [...keywords.slice(0, 20), 'k0'] });
    expect(deduped.status).toBe(200);
    expect((await getStored(classId))?.keywords).toHaveLength(20);
  });

  it('rejects them on a merch listing', async () => {
    const classId = '0xpendingmetadatamerch';
    await seedListing(classId, { productType: 'merch' });

    const res = await postSettings(classId, { keywords: ['tote'] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.data)).toContain('BOOK_ONLY_FIELDS');
  });

  it('is not accepted on a new listing, which reads them from chain', () => {
    expect(NewListingBodySchema.shape).not.toHaveProperty('genre');
    expect(NewListingBodySchema.shape).not.toHaveProperty('keywords');
  });
});

describe('ISCN sync of pending genre and keywords', () => {
  beforeEach(() => {
    mockGetNFTClassData.mockReset();
    mockUpdateAirtable.mockReset();
    setChainMetadata(CHAIN_METADATA);
  });

  it('keeps them while chain was signed before the write', async () => {
    const classId = mockEVMAddress(0xc1);
    await seedListing(classId);
    await postSettings(classId, { genre: 'Fiction', keywords: ['新'] });

    expect((await postRefresh(classId)).status).toBe(200);

    const stored = await getStored(classId);
    expect(stored?.genre).toBe('Fiction');
    expect(stored?.keywords).toEqual(['新']);
    expect(stored?.pendingMetadataFields).toEqual(['genre', 'keywords']);
  });

  it('keeps them when chain metadata has no recordTimestamp', async () => {
    const classId = mockEVMAddress(0xc2);
    await seedListing(classId);
    await postSettings(classId, { keywords: ['新'] });
    setChainMetadata({ ...CHAIN_METADATA, recordTimestamp: undefined });

    await postRefresh(classId);

    const stored = await getStored(classId);
    expect(stored?.keywords).toEqual(['新']);
    expect(stored?.pendingMetadataFields).toEqual(['keywords']);
  });

  it('still syncs fields that are not pending', async () => {
    const classId = mockEVMAddress(0xc3);
    await seedListing(classId);
    await postSettings(classId, { keywords: ['新'] });
    setChainMetadata({ ...CHAIN_METADATA, genre: 'Poetry' });

    await postRefresh(classId);

    const stored = await getStored(classId);
    expect(stored?.genre).toBe('Poetry');
    expect(stored?.keywords).toEqual(['新']);
  });

  it('lifts them and takes chain values once the owner signs after the write', async () => {
    const classId = mockEVMAddress(0xc4);
    await seedListing(classId);
    await postSettings(classId, { genre: 'Fiction', keywords: ['新'] });
    setChainMetadata({
      ...CHAIN_METADATA,
      genre: 'Fiction',
      keywords: ['新', '書主加的'],
      recordTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    await postRefresh(classId);

    const stored = await getStored(classId);
    expect(stored?.genre).toBe('Fiction');
    expect(stored?.keywords).toEqual(['新', '書主加的']);
    expect(stored?.pendingMetadataFields).toBeUndefined();
    expect(stored?.pendingMetadataUpdatedAt).toBeUndefined();
    expect(mockUpdateAirtable).toHaveBeenLastCalledWith(expect.objectContaining({
      genre: 'Fiction', keywords: ['新', '書主加的'],
    }));
  });

  it('lifts them and clears the listing when the owner signed them empty', async () => {
    const classId = mockEVMAddress(0xc5);
    await seedListing(classId);
    await postSettings(classId, { genre: 'Fiction', keywords: ['新'] });
    setChainMetadata({
      name: 'Chain Name',
      genre: '',
      keywords: '',
      recordTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    await postRefresh(classId);

    const stored = await getStored(classId);
    expect(stored?.genre).toBeUndefined();
    expect(stored?.keywords).toBeUndefined();
    expect(stored?.pendingMetadataFields).toBeUndefined();
    expect(mockUpdateAirtable).toHaveBeenLastCalledWith(expect.objectContaining({
      genre: null, keywords: null,
    }));
  });

  it('keeps listing keywords on an empty chain read when none are pending', async () => {
    const classId = mockEVMAddress(0xc6);
    await seedListing(classId, { keywords: ['legacy'] });
    setChainMetadata({ name: 'Chain Name', keywords: '' });

    await postRefresh(classId);

    expect((await getStored(classId))?.keywords).toEqual(['legacy']);
  });
});
