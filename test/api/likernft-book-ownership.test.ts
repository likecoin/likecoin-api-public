import {
  describe, it, expect, vi,
} from 'vitest';
import { getAddress } from 'viem';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { jwtSign } from './jwt';
import { likeNFTBookCollection, likeNFTBookUserCollection } from '../../src/util/firebase';
import { getNFTClassOwner } from '../../src/util/evm/nft';
import { updateAirtablePublicationRecord } from '../../src/util/airtable';

vi.mock('../../src/util/evm/nft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/util/evm/nft')>()),
  getNFTClassOwner: vi.fn(),
}));
vi.mock('../../src/util/airtable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/util/airtable')>()),
  updateAirtablePublicationRecord: vi.fn(),
}));

const mockGetNFTClassOwner = vi.mocked(getNFTClassOwner);
const mockUpdateAirtable = vi.mocked(updateAirtablePublicationRecord);

const BASE_URL = '/api/likernft/book/store';
const OWNER = mockEVMAddress(0x91);
const NEW_OWNER = mockEVMAddress(0x92);
const MODERATOR = mockEVMAddress(0x93);
const AUTHOR = mockEVMAddress(0x94);
const TX_HASH = `0x${'ab'.repeat(32)}`;
const LEGACY_OWNER = 'like1legacyownerwallet';

const seedListing = (classId: string, data: Record<string, unknown> = {}) => likeNFTBookCollection
  .doc(classId)
  .set({
    classId, ownerWallet: OWNER, moderatorWallets: [MODERATOR], prices: [], ...data,
  } as any);

const postOwnership = (
  classId: string,
  payload: Record<string, unknown>,
  wallet = OWNER,
) => axiosist
  .post(`${BASE_URL}/${classId}/ownership`, payload, {
    headers: {
      Authorization: `Bearer ${jwtSign({ wallet, permissions: ['read:nftbook', 'write:nftbook'] })}`,
    },
  })
  .catch((err) => (err as any).response);

const getStored = async (classId: string) => (
  await likeNFTBookCollection.doc(classId).get()
).data();

describe('POST /likernft/book/store/:classId/ownership', () => {
  it('moves the listing to the new owner once the chain has transferred', async () => {
    const classId = mockEVMAddress(0xa1);
    await seedListing(classId, { connectedWallets: { [OWNER]: 70, [AUTHOR]: 30 } });
    await likeNFTBookUserCollection.doc(getAddress(NEW_OWNER))
      .set({ isStripeConnectReady: true } as any);
    mockGetNFTClassOwner.mockResolvedValue(getAddress(NEW_OWNER));

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER, txHash: TX_HASH });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ classId, ownerWallet: getAddress(NEW_OWNER) });
    expect(mockGetNFTClassOwner).toHaveBeenCalledWith(classId, { skipCache: true });

    const stored = await getStored(classId);
    expect(stored?.ownerWallet).toBe(getAddress(NEW_OWNER));
    expect(stored?.moderatorWallets).toEqual([MODERATOR]);
    expect(stored?.connectedWallets).toEqual({ [AUTHOR]: 30, [getAddress(NEW_OWNER)]: 70 });
    expect(stored?.ownershipHistory).toEqual([expect.objectContaining({
      fromWallet: OWNER,
      toWallet: getAddress(NEW_OWNER),
      txHash: TX_HASH,
    })]);
    expect(mockUpdateAirtable).toHaveBeenCalledWith({
      id: classId,
      ownerWallet: getAddress(NEW_OWNER),
    });
  });

  it('leaves connectedWallets alone when the owner has no share in it', async () => {
    const classId = mockEVMAddress(0xa2);
    await seedListing(classId, { connectedWallets: { [AUTHOR]: 100 } });
    mockGetNFTClassOwner.mockResolvedValue(getAddress(NEW_OWNER));

    expect((await postOwnership(classId, { newOwnerWallet: NEW_OWNER })).status).toBe(200);
    expect((await getStored(classId))?.connectedWallets).toEqual({ [AUTHOR]: 100 });
  });

  it('rejects moving the owner payout share to a wallet without Stripe Connect', async () => {
    const classId = mockEVMAddress(0xa7);
    await seedListing(classId, { connectedWallets: { [OWNER]: 70, [AUTHOR]: 30 } });
    mockGetNFTClassOwner.mockResolvedValue(getAddress(NEW_OWNER));

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER });
    expect(res.status).toBe(400);
    expect(res.data).toContain('NEW_OWNER_STRIPE_CONNECT_NOT_READY');
    expect((await getStored(classId))?.ownerWallet).toBe(OWNER);
  });

  it('transfers a listing still owned by a legacy like1 wallet', async () => {
    const classId = mockEVMAddress(0xa8);
    await seedListing(classId, { ownerWallet: LEGACY_OWNER });
    mockGetNFTClassOwner.mockResolvedValue(getAddress(NEW_OWNER));

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER }, LEGACY_OWNER);
    expect(res.status).toBe(200);
    expect((await getStored(classId))?.ownerWallet).toBe(getAddress(NEW_OWNER));
  });

  it('rejects a caller who is only a moderator', async () => {
    const classId = mockEVMAddress(0xa3);
    await seedListing(classId);
    mockGetNFTClassOwner.mockResolvedValue(getAddress(NEW_OWNER));

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER }, MODERATOR);
    expect(res.status).toBe(403);
    expect(res.data).toContain('NOT_OWNER_OF_NFT_CLASS');
    expect((await getStored(classId))?.ownerWallet).toBe(OWNER);
  });

  it('rejects while the chain still names another owner', async () => {
    const classId = mockEVMAddress(0xa4);
    await seedListing(classId);
    mockGetNFTClassOwner.mockResolvedValue(getAddress(OWNER));

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER });
    expect(res.status).toBe(409);
    expect(res.data).toContain('ON_CHAIN_OWNER_MISMATCH');
    expect((await getStored(classId))?.ownerWallet).toBe(OWNER);
    expect(mockUpdateAirtable).not.toHaveBeenCalled();
  });

  it('rejects an invalid new owner address', async () => {
    const classId = mockEVMAddress(0xa5);
    await seedListing(classId);

    const res = await postOwnership(classId, { newOwnerWallet: '0x1234' });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_INPUT');
    expect(mockGetNFTClassOwner).not.toHaveBeenCalled();
  });

  it('rejects transferring to the current owner', async () => {
    const classId = mockEVMAddress(0xa6);
    await seedListing(classId);

    const res = await postOwnership(classId, { newOwnerWallet: getAddress(OWNER) });
    expect(res.status).toBe(400);
    expect(res.data).toContain('SAME_OWNER_WALLET');
  });

  it('rejects a merch listing, which has no chain class', async () => {
    const classId = '0xmerchownership1';
    await seedListing(classId, { productType: 'merch' });

    const res = await postOwnership(classId, { newOwnerWallet: NEW_OWNER });
    expect(res.status).toBe(400);
    expect(res.data).toContain('OWNERSHIP_TRANSFER_NOT_SUPPORTED');
  });
});
