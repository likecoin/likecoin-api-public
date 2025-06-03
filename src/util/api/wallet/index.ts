import { createAirtablePublicationRecord } from '../../airtable';
import { isValidLikeAddress } from '../../cosmos';
import { getNFTClassDataById, isEVMClassId } from '../../evm/nft';
import {
  db,
  FieldValue,
  likeNFTBookCollection,
  likeNFTBookUserCollection,
  likeNFTCollectionCollection,
  userCollection,
} from '../../firebase';
import { migrateLikerLandEVMWallet } from '../../liker-land';
import { createStripeProductFromNFTBookPrice } from '../likernft/book';
import stripe from '../../stripe';
import { bookCacheBucket } from '../../gcloudStorage';

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
      const [userDoc, evmUserDoc] = await Promise.all([
        t.get(likeNFTBookUserCollection.doc(likeWallet)),
        t.get(likeNFTBookUserCollection.doc(evmWallet)),
      ]);
      if (evmUserDoc.exists) {
        const {
          likeWallet: evmLikeWallet,
        } = evmUserDoc.data();
        if (evmLikeWallet) {
          if (evmLikeWallet !== likeWallet) {
            throw new Error('EVM_WALLET_USED_BY_OTHER_USER');
          } else {
            return {
              userExists: true,
              alreadyMigrated: true,
            };
          }
        }
      }
      if (!userDoc.exists) {
        t.create(likeNFTBookUserCollection.doc(likeWallet), {
          evmWallet,
          migrateTimestamp: FieldValue.serverTimestamp(),
          timestamp: FieldValue.serverTimestamp(),
        });
      } else {
        const userData = userDoc.data();
        const { evmWallet: existingEVMWallet } = userData;
        if (existingEVMWallet && existingEVMWallet !== evmWallet) {
          throw new Error('EVM_WALLET_NOT_MATCH_USER_RECORD');
        }
        t.update(userDoc.ref, {
          evmWallet,
          migrateTimestamp: FieldValue.serverTimestamp(),
        });
      }
      if (!evmUserDoc.exists) {
        t.create(likeNFTBookUserCollection.doc(evmWallet), {
          likeWallet,
          migrateTimestamp: FieldValue.serverTimestamp(),
          timestamp: FieldValue.serverTimestamp(),
        });
      } else {
        t.update(likeNFTBookUserCollection.doc(evmWallet), {
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
    const evmData = await getNFTClassDataById(evmClassId);
    if (evmData?.likecoin?.classId !== likeClassId) {
      throw new Error('EVM_CLASS_ID_NOT_MATCH_LIKE_CLASS_ID');
    }
    const res = await db.runTransaction(async (t) => {
      const migratedClassIds: string[] = [];
      const migratedClassDatas: any[] = [];
      const migratedCollectionIds: string[] = [];
      const [bookListingDoc, collectionQuery] = await Promise.all([
        t.get(likeNFTBookCollection.doc(likeClassId)),
        t.get(likeNFTCollectionCollection.where('classIds', 'array-contains', likeClassId).limit(100)),
      ]);
      if (bookListingDoc.exists) {
        const {
          evmClassId: existingEVMClassId,
          ownerWallet,
          connectedWallets,
        } = bookListingDoc.data();
        if (!existingEVMClassId) {
          let newOwnerWallet = ownerWallet;
          if (ownerWallet && isValidLikeAddress(ownerWallet)) {
            const evmWallet = await findLikeWalletByEVMWallet(ownerWallet);
            if (evmWallet) {
              const ratio = connectedWallets?.[ownerWallet];
              if (ratio) {
                delete connectedWallets[ownerWallet];
                connectedWallets[evmWallet] = ratio;
              }
              newOwnerWallet = evmWallet;
            }
          }
          const migratedData = {
            ...bookListingDoc.data(),
            chain: 'evm',
            likeClassId,
            classId: evmClassId,
            ownerWallet: newOwnerWallet,
          };
          if (connectedWallets) {
            migratedData.connectedWallets = connectedWallets;
          }

          t.update(bookListingDoc.ref, { evmClassId });
          t.create(likeNFTBookCollection.doc(evmClassId), ({
            ...migratedData,
            migrateTimestamp: FieldValue.serverTimestamp(),
          }));
          migratedClassIds.push(likeClassId);
          migratedClassDatas.push(migratedData);
        }
      }
      for (let i = 0; i < collectionQuery.docs.length; i += 1) {
        const doc = collectionQuery.docs[i];
        const {
          classIds,
          ownerWallet,
          connectedWallets,
        } = doc.data();
        const index = classIds.indexOf(likeClassId);
        if (index >= 0) {
          classIds[index] = evmClassId;
          let newOwnerWallet = ownerWallet;
          if (ownerWallet && isValidLikeAddress(ownerWallet)) {
            newOwnerWallet = await findLikeWalletByEVMWallet(ownerWallet);
            const ratio = connectedWallets?.[ownerWallet];
            if (ratio) {
              delete connectedWallets[ownerWallet];
              connectedWallets[newOwnerWallet] = ratio;
            }
            newOwnerWallet = newOwnerWallet || ownerWallet;
          }
          const migrateData: any = {
            classIds,
            ownerWallet,
            chain: classIds.every((id) => isEVMClassId(id)) ? 'evm' : 'like',
          };
          if (connectedWallets) {
            migrateData.connectedWallets = connectedWallets;
          }
          t.update(doc.ref, migrateData);
          migratedCollectionIds.push(doc.id);
        }
      }
      return {
        migratedClassIds,
        migratedClassDatas,
        migratedCollectionIds,
      };
    });
    for (const classData of res.migratedClassDatas) {
      const {
        id: classId,
        ownerWallet,
        hideDownload,
        prices,
      } = classData;
      const metadata = await getNFTClassDataById(classId);
      const {
        inLanguage,
        name,
        description,
        author,
        publisher,
        usageInfo,
        isbn,
        image,
        keywords,
      } = metadata;
      const stripeProducts = await Promise.all(prices
        .map((p, index) => createStripeProductFromNFTBookPrice(classId, index, {
          bookInfo: classData,
          price: p,
          site: '3ook.com',
        })));
      await likeNFTBookCollection.doc(classId).update({
        prices: prices.map((p, index) => ({
          ...p,
          ...stripeProducts[index],
        })),
      });
      await Promise.all(prices.map((p) => {
        if (p.stripeProductId) {
          return stripe.products.update(p.stripeProductId, {
            active: false,
          });
        }
        return Promise.resolve();
      }));
      await createAirtablePublicationRecord({
        id: classId,
        timestamp: new Date(),
        name,
        description,
        metadata,
        ownerWallet,
        type: metadata?.nft_meta_collection_id,
        minPrice: prices.reduce((min, p) => Math.min(min, p.priceInDecimal), Infinity) / 100,
        maxPrice: prices.reduce((max, p) => Math.max(max, p.priceInDecimal), 0) / 100,
        imageURL: image,
        language: inLanguage,
        keywords,
        author: typeof author === 'string' ? author : author?.name || '',
        publisher,
        usageInfo,
        isbn,
        isDRMFree: !hideDownload,
      });
      try {
        const oldSignImagePath = `${likeClassId}/sign.png`;
        const oldMemoImagePath = `${likeClassId}/memo.png`;
        if ((await bookCacheBucket.file(oldSignImagePath).exists())[0]) {
          const newSignImagePath = `${evmClassId}/sign.png`;
          await bookCacheBucket.file(oldSignImagePath).copy(bookCacheBucket.file(newSignImagePath));
        }
        if ((await bookCacheBucket.file(oldMemoImagePath).exists())[0]) {
          const newMemoImagePath = `${evmClassId}/memo.png`;
          await bookCacheBucket.file(oldMemoImagePath).copy(bookCacheBucket.file(newMemoImagePath));
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error migrating book cache files:', error);
      }
    }

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
