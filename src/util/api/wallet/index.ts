import {
  db, FieldValue, likeNFTBookUserCollection, userCollection,
} from '../../firebase';
import { migrateLikerLandEvmWallet } from '../../liker-land';

export async function findLikeWalletByEvmWallet(evmWallet: string) {
  const userQuery = await likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).get();
  if (userQuery.docs.length === 0) {
    return null;
  }
  return userQuery.docs[0].data()?.likeWallet;
}

async function migrateBookUser(likeWallet: string, evmWallet: string) {
  try {
    const userExists = await db.runTransaction(async (t) => {
      const [evmQuery, userDoc] = await Promise.all([
        t.get(likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).limit(1)),
        t.get(likeNFTBookUserCollection.doc(likeWallet).get()),
      ]);
      if (evmQuery.docs.length > 0) {
        throw new Error('EVM_WALLET_ALREADY_EXIST');
      }
      if (!userDoc.exists) {
        t.create(likeNFTBookUserCollection.doc(likeWallet), {
          evmWallet,
          likeWallet,
          timestamp: FieldValue.serverTimestamp(),
        });
      } else {
        t.update({ evmWallet, likeWallet });
      }
      return userDoc.exists;
    });
    return { error: null };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

async function migrateLikerId(likeWallet:string, evmWallet: string) {
  try {
    const likerId = await db.runTransaction(async (t) => {
      const [evmQuery, userQuery] = await Promise.all([
        t.get(userCollection.where('evmWallet', '==', evmWallet).limit(1)),
        t.get(userCollection.where('likeWallet', '==', likeWallet).limit(1)),
      ]);
      if (evmQuery.docs.length > 0) {
        throw new Error('EVM_WALLET_ALREADY_EXIST');
      }
      if (userQuery.docs.length === 0) {
        throw new Error('LIKE_WALLET_NOT_FOUND');
      }
      const userDoc = userQuery.docs[0];
      t.update(userDoc.ref, { evmWallet });
      return userDoc.id;
    });
    return { likerId, error: null };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

export async function migrateLikeWalletToEvmWallet(likeWallet: string, evmWallet: string) {
  const [
    { error: migrateBookUserError },
    { error: migrateLikerIdError, likerId },
    { error: migrateLikerLandError, user: likerLandUser },
  ] = await Promise.all([
    migrateBookUser(likeWallet, evmWallet),
    migrateLikerId(likeWallet, evmWallet),
    migrateLikerLandEvmWallet(likeWallet, evmWallet),
  ]);
  return {
    isMigratedBookUser: !migrateBookUserError,
    isMigratedLikerId: !migrateLikerIdError,
    isMigratedLikerLand: !migrateLikerLandError,
    migratedLikerId: likerId,
    migratedLikerLandUser: likerLandUser,
    migrateBookUserError,
    migrateLikerIdError,
    migrateLikerLandError,
  };
}

export default findLikeWalletByEvmWallet;
