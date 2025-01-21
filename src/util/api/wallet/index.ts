import { isValidLikeAddress } from '../../cosmos';
import {
  db, FieldValue, likeNFTBookCollection, likeNFTBookUserCollection, userCollection,
} from '../../firebase';
import { migrateLikerLandEVMWallet } from '../../liker-land';

export async function findLikeWalletByEVMWallet(evmWallet: string) {
  const userQuery = await likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).get();
  if (userQuery.docs.length === 0) {
    return null;
  }
  const docId = userQuery.docs[0].id;
  if (isValidLikeAddress(docId)) {
    return docId;
  }
  return null;
}

async function migrateBookUser(likeWallet: string, evmWallet: string) {
  try {
    const userExists = await db.runTransaction(async (t) => {
      const [evmQuery, userDoc, bookQuery] = await Promise.all([
        t.get(likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).limit(1)),
        t.get(likeNFTBookUserCollection.doc(likeWallet).get()),
        t.get(likeNFTBookCollection.where('ownerWallet', '==', likeWallet).limit(1)),
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
        t.update(userDoc, { evmWallet, likeWallet });
      }
      bookQuery.docs.forEach((doc) => {
        t.update(doc.ref, { ownerWallet: evmWallet });
      });
      return userDoc.exists;
    });
    return { error: null };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

async function migrateBookOwner(likeWallet: string, evmWallet: string) {
  try {
    await db.runTransaction(async (t) => {
      const bookQuery = await t.get(likeNFTBookCollection.where('ownerWallet', '==', likeWallet));
      bookQuery.docs.forEach((doc) => {
        t.update(doc.ref, { ownerWallet: evmWallet });
      });
    });
    await db.runTransaction(async (t) => {
      const bookQuery = await t.get(likeNFTBookCollection.where(`connectedWallets.${likeWallet}`, '>', 0));
      bookQuery.docs.forEach((doc) => {
        const {
          connectedWallets,
        } = doc.data();
        const ratio = connectedWallets[likeWallet];
        delete connectedWallets[likeWallet];
        connectedWallets[evmWallet] = ratio;
        t.update(doc.ref, { connectedWallets });
      });
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

export async function migrateLikeWalletToEVMWallet(likeWallet: string, evmWallet: string) {
  const [
    { error: migrateBookUserError },
    { error: migrateBookOwnerError },
    { error: migrateLikerIdError, likerId },
    { error: migrateLikerLandError, user: likerLandUser },
  ] = await Promise.all([
    migrateBookUser(likeWallet, evmWallet),
    migrateBookOwner(likeWallet, evmWallet),
    migrateLikerId(likeWallet, evmWallet),
    migrateLikerLandEVMWallet(likeWallet, evmWallet),
  ]);
  return {
    isMigratedBookUser: !migrateBookUserError,
    isMigratedBookOwner: !migrateBookOwnerError,
    isMigratedLikerId: !migrateLikerIdError,
    isMigratedLikerLand: !migrateLikerLandError,
    migratedLikerId: likerId,
    migratedLikerLandUser: likerLandUser.id,
    migrateBookUserError,
    migrateBookOwnerError,
    migrateLikerIdError,
    migrateLikerLandError,
  };
}

export default findLikeWalletByEVMWallet;
