import {
  beforeEach, describe, expect, it,
} from 'vitest';
import { checksumAddress } from 'viem';

import {
  parseUserUnlimitedUploadQuery,
  setUserUnlimitedSponsoredUpload,
} from '../../src/util/api/likernft/book/unlimitedUpload';
import { getRemainingQuota } from '../../src/util/api/arweave/quota';
import { likeNFTBookUserCollection, userCollection } from '../../src/util/firebase';

const EVM_WALLET = checksumAddress(`0x${'a7'.repeat(20)}`);
const LIKE_WALLET = `like1${'q'.repeat(38)}`;

const USERS: [string, Record<string, unknown>][] = [
  ['uuemail', { email: 'uuemail@example.com', evmWallet: EVM_WALLET }],
  ['uulike', { likeWallet: LIKE_WALLET }],
  ['uunowallet', {}],
  ['uudeleted', { evmWallet: `0x${'b8'.repeat(20)}`, isDeleted: true }],
];

async function getStored(wallet: string) {
  return (await likeNFTBookUserCollection.doc(wallet).get()).data();
}

beforeEach(async () => {
  await Promise.all(USERS.map(([id, data]) => (
    userCollection.doc(id).set({ displayName: id, ...data }))));
  await likeNFTBookUserCollection.doc(EVM_WALLET).set({
    sponsoredUploadCount: 3,
  } as any);
});

describe('parseUserUnlimitedUploadQuery', () => {
  it('parses on and off, case-insensitively', () => {
    expect(parseUserUnlimitedUploadQuery(['alice', 'ON']))
      .toEqual({ query: 'alice', isUnlimitedSponsoredUpload: true });
    expect(parseUserUnlimitedUploadQuery([EVM_WALLET, 'off']))
      .toEqual({ query: EVM_WALLET, isUnlimitedSponsoredUpload: false });
  });

  it.each([
    ['no params', []],
    ['a missing toggle', ['alice']],
    ['an unknown toggle', ['alice', 'yes']],
    ['extra params', ['alice', 'on', '1']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseUserUnlimitedUploadQuery(params)).toThrow();
  });
});

describe('setUserUnlimitedSponsoredUpload', () => {
  it.each([
    ['email', 'uuemail@example.com'],
    ['liker ID', 'uuemail'],
    ['EVM wallet', EVM_WALLET],
  ])('sets the flag on the wallet of a user found by %s', async (_label, query) => {
    const result = await setUserUnlimitedSponsoredUpload({
      query,
      isUnlimitedSponsoredUpload: true,
    });

    expect(result).toEqual({ user: 'uuemail', wallet: EVM_WALLET, isUnlimitedSponsoredUpload: true });
    expect(await getStored(EVM_WALLET)).toMatchObject({
      isUnlimitedSponsoredUpload: true,
      sponsoredUploadCount: 3,
    });
    expect(await getRemainingQuota(EVM_WALLET)).toEqual({ isUnlimited: true });
  });

  it('falls back to likeWallet and creates the book user doc', async () => {
    const result = await setUserUnlimitedSponsoredUpload({ query: 'uulike', isUnlimitedSponsoredUpload: true });

    expect(result).toEqual({ user: 'uulike', wallet: LIKE_WALLET, isUnlimitedSponsoredUpload: true });
    expect(await getStored(LIKE_WALLET)).toMatchObject({ isUnlimitedSponsoredUpload: true });
  });

  it('turns the flag off and restores the daily quota', async () => {
    await setUserUnlimitedSponsoredUpload({ query: 'uuemail', isUnlimitedSponsoredUpload: true });
    await setUserUnlimitedSponsoredUpload({ query: 'uuemail', isUnlimitedSponsoredUpload: false });

    expect(await getStored(EVM_WALLET)).toMatchObject({ isUnlimitedSponsoredUpload: false });
    expect(await getRemainingQuota(EVM_WALLET)).toMatchObject({ isUnlimited: false });
  });

  it.each([
    ['does not exist', 'nobody@example.com'],
    ['is deleted', 'uudeleted'],
  ])('rejects a user that %s', async (_label, query) => {
    await expect(setUserUnlimitedSponsoredUpload({ query, isUnlimitedSponsoredUpload: true }))
      .rejects.toThrow('User not found');
  });

  it('rejects a user without a wallet', async () => {
    await expect(setUserUnlimitedSponsoredUpload({ query: 'uunowallet', isUnlimitedSponsoredUpload: true }))
      .rejects.toThrow('has no wallet');
  });
});
