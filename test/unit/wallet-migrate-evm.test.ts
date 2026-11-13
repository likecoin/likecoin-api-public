import {
  describe, it, expect, afterEach,
} from 'vitest';
import { checksumAddress } from 'viem';
import { migrateLikeWalletToEVMWallet } from '../../src/util/api/wallet';
import { FieldValue, likeNFTBookUserCollection, userCollection } from '../../src/util/firebase';

// Held by the `testinglikeuser` fixture. See test/data/user.json.
const LIKER_ID = 'testinglikeuser';
const LIKE_WALLET = 'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww';
const NEW_EVM_WALLET = checksumAddress('0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c');

describe('migrateLikeWalletToEVMWallet', () => {
  // resetTestData() re-requires the cached fixture JSON, so a write to a fixture
  // doc otherwise outlives its test and leaks into later files.
  afterEach(async () => {
    await userCollection.doc(LIKER_ID).update({
      evmWallet: FieldValue.delete(),
      migrateMethod: FieldValue.delete(),
      migrateTimestamp: FieldValue.delete(),
    });
  });

  it('reports the liker.land step as never attempted', async () => {
    const res = await migrateLikeWalletToEVMWallet(LIKE_WALLET, NEW_EVM_WALLET, 'auto');
    expect(res.isMigratedLikerId).toBe(true);
    expect(res.isMigratedLikerLand).toBe(false);
    expect(res.migratedLikerLandUser).toBeNull();
    expect(res.migrateLikerLandError).toBeNull();
  });

  it('copies distribution royalties to the EVM wallet', async () => {
    // Parent docs must exist before their subcollections persist in the firebase stub.
    await likeNFTBookUserCollection.doc(LIKE_WALLET).set({} as any);
    await likeNFTBookUserCollection.doc(LIKE_WALLET).collection('distributionRoyalties')
      .doc('2026Q1').set({ period: '2026Q1', payableUsd: 90, status: 'paid' });

    const res = await migrateLikeWalletToEVMWallet(LIKE_WALLET, NEW_EVM_WALLET, 'auto');
    expect(res.isMigratedBookUser).toBe(true);
    const doc = await likeNFTBookUserCollection.doc(NEW_EVM_WALLET)
      .collection('distributionRoyalties').doc('2026Q1').get();
    expect(doc.data()).toEqual({ period: '2026Q1', payableUsd: 90, status: 'paid' });
  });
});
