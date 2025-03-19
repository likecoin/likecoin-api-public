import { isValidLikeAddress } from '../../cosmos';
import {
  db,
  FieldValue,
  likeNFTBookCollection,
  likeNFTBookUserCollection,
  likeNFTCollectionCollection,
  userCollection,
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

export async function checkBookUserEVMWallet(likeWallet: string) {
  const userQuery = await likeNFTBookUserCollection.doc(likeWallet).get();
  if (!userQuery.exists) {
    return null;
  }
  return userQuery.data()?.evmWallet || null;
}

async function migrateBookUser(likeWallet: string, evmWallet: string) {
  try {
    const { userExists, alreadyMigrated } = await db.runTransaction(async (t) => {
      const [evmQuery, userDoc] = await Promise.all([
        t.get(likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).limit(1)),
        t.get(likeNFTBookUserCollection.doc(likeWallet)),
      ]);
      if (evmQuery.docs.length > 0) {
        if (evmQuery.docs[0].id !== userDoc?.id) {
          throw new Error('EVM_WALLET_USED_BY_OTHER_USER');
        }
        return {
          userExists: true,
          alreadyMigrated: true,
        };
      }
      if (!userDoc.exists) {
        t.create(likeNFTBookUserCollection.doc(likeWallet), {
          evmWallet,
          likeWallet,
          migrateTimestamp: FieldValue.serverTimestamp(),
          timestamp: FieldValue.serverTimestamp(),
        });
      } else {
        const { evmWallet: existingEVMWallet } = userDoc.data();
        if (existingEVMWallet && existingEVMWallet !== evmWallet) {
          throw new Error('EVM_WALLET_NOT_MATCH_USER_RECORD');
        }
        t.update(userDoc.ref, {
          evmWallet,
          likeWallet,
          migrateTimestamp: FieldValue.serverTimestamp(),
        });
      }
      return {
        userExists: userDoc.exists,
        alreadyMigrated: false,
      };
    });
    return { error: null, userExists, alreadyMigrated };
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
    return { likerId: null, error: (error as Error).message };
  }
}

export async function migrateBookClassId(likeClassId:string, evmClassId: string) {
  try {
    // TODO: verify evmClassId contains information about likeClassId
    const res = await db.runTransaction(async (t) => {
      const migratedClassIds: string[] = [];
      const migratedCollectionIds: string[] = [];
      const [bookListingDoc, collectionQuery] = await Promise.all([
        t.get(likeNFTBookCollection.doc(likeClassId)),
        t.get(likeNFTCollectionCollection.where('classIds', 'array-contains', likeClassId).limit(100)),
      ]);
      if (bookListingDoc.exists) {
        const { evmClassId: existingEVMClassId } = bookListingDoc.data();
        if (!existingEVMClassId) {
          t.update(bookListingDoc.ref, { evmClassId });
          migratedClassIds.push(likeClassId);
        }
      }
      collectionQuery.docs.forEach((doc) => {
        const { classIds } = doc.data();
        const index = classIds.indexOf(likeClassId);
        if (index >= 0) {
          classIds[index] = evmClassId;
          t.update(doc.ref, { classIds });
          migratedCollectionIds.push(doc.id);
        }
      });
      return {
        migratedClassIds,
        migratedCollectionIds,
      };
    });
    const {
      migratedClassIds,
      migratedCollectionIds,
    } = res;
    return {
      error: null,
      migratedClassIds,
      migratedCollectionIds,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

export async function migrateLikeUserToEVMUser(likeWallet: string, evmWallet: string) {
  const { error: migrateBookUserError } = await migrateBookUser(likeWallet, evmWallet);
  if (migrateBookUserError) {
    return {
      isMigratedBookUser: false,
      isMigratedLikerId: false,
      isMigratedLikerLand: false,
      migratedLikerId: null,
      migratedLikerLandUser: null,
      migrateBookUserError,
      migrateLikerIdError: null,
      migrateLikerLandError: null,
    };
  }
  const [
    { error: migrateLikerIdError, likerId },
    { error: migrateLikerLandError, user: likerLandUser },
  ] = await Promise.all([
    migrateLikerId(likeWallet, evmWallet),
    migrateLikerLandEVMWallet(likeWallet, evmWallet),
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

export async function migrateLikeWalletToEVMWallet(likeWallet: string, evmWallet: string) {
  const { error: migrateBookUserError } = await migrateBookUser(likeWallet, evmWallet);
  if (migrateBookUserError) {
    return {
      isMigratedBookUser: false,
      isMigratedBookOwner: false,
      isMigratedLikerId: false,
      isMigratedLikerLand: false,
      migratedLikerId: null,
      migratedLikerLandUser: null,
      migrateBookUserError,
      migrateBookOwnerError: null,
      migrateLikerIdError: null,
      migrateLikerLandError: null,
    };
  }
  const [
    { error: migrateBookOwnerError },
    { error: migrateLikerIdError, likerId },
    { error: migrateLikerLandError, user: likerLandUser },
  ] = await Promise.all([
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
