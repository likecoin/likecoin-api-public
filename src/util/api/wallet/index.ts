import { checksumAddress } from 'viem';
import { createAirtablePublicationRecord } from '../../airtable';
import { isValidLikeAddress } from '../../cosmos';
import { getNFTClassDataById, isEVMClassId } from '../../evm/nft';
import {
  admin,
  db,
  FieldValue,
  likeNFTBookCollection,
  likeNFTBookUserCollection,
  userCollection,
} from '../../firebase';
import { migrateLikerLandEVMWallet } from '../../liker-land';
import { createStripeProductFromNFTBookPrice } from '../likernft/book';
import stripe from '../../stripe';
import { bookCacheBucket } from '../../gcloudStorage';
import { updateIntercomUserEvmWallet } from '../../intercom';

export async function findLikeWalletByEVMWallet(evmWallet: string) {
  const userQuery = await likeNFTBookUserCollection.where('evmWallet', '==', checksumAddress(evmWallet as `0x${string}`)).get();
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

async function migrateBookUser(likeWallet: string, evmWallet: string, method: 'manual' | 'auto' = 'manual') {
  try {
    const { userExists, alreadyMigrated } = await db.runTransaction(
      async (t: admin.firestore.Transaction) => {
        const [userDoc, userCommissionCollection, evmUserDoc] = await Promise.all([
          t.get(likeNFTBookUserCollection.doc(likeWallet)),
          t.get(likeNFTBookUserCollection.doc(likeWallet).collection('commissions')),
          t.get(likeNFTBookUserCollection.doc(evmWallet)),
        ]);
        const oldUserData = userDoc.exists ? userDoc.data() : {};
        if (evmUserDoc.exists) {
          const evmUserData = evmUserDoc.data();
          if (!evmUserData) throw new Error('EVM_USER_DATA_NOT_FOUND');
          const {
            likeWallet: evmLikeWallet,
          } = evmUserData;
          if (evmLikeWallet) {
            if (evmLikeWallet !== likeWallet) {
              throw new Error('EVM_WALLET_USED_BY_OTHER_USER');
            }
            return {
              userExists: true,
              alreadyMigrated: true,
            };
          }
          t.update(likeNFTBookUserCollection.doc(evmWallet), {
            ...oldUserData,
            ...evmUserDoc.data(),
            likeWallet,
            migrateMethod: method,
            migrateTimestamp: FieldValue.serverTimestamp(),
          });
        } else {
          t.create(likeNFTBookUserCollection.doc(evmWallet), {
            ...oldUserData,
            likeWallet,
            migrateMethod: method,
            migrateTimestamp: FieldValue.serverTimestamp(),
            timestamp: FieldValue.serverTimestamp(),
          });
          userCommissionCollection.docs.forEach((doc) => {
            t.create(likeNFTBookUserCollection.doc(evmWallet).collection('commissions').doc(doc.id), doc.data());
          });
        }
        if (!userDoc.exists) {
          t.create(likeNFTBookUserCollection.doc(likeWallet), {
            evmWallet,
            migrateMethod: method,
            migrateTimestamp: FieldValue.serverTimestamp(),
            timestamp: FieldValue.serverTimestamp(),
          });
        } else {
          const { evmWallet: existingEVMWallet } = oldUserData as any;
          if (existingEVMWallet && existingEVMWallet !== evmWallet) {
            throw new Error('EVM_WALLET_NOT_MATCH_USER_RECORD');
          }
          t.update(userDoc.ref, {
            evmWallet,
            migrateMethod: method,
            migrateTimestamp: FieldValue.serverTimestamp(),
          });
        }
        return {
          userExists: userDoc.exists,
          alreadyMigrated: false,
        };
      },
    );
    return { error: null, userExists, alreadyMigrated };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

async function migrateBookOwner(likeWallet: string, evmWallet: string) {
  try {
    await db.runTransaction(async (t: admin.firestore.Transaction) => {
      const bookQuery = await t.get(likeNFTBookCollection.where('ownerWallet', '==', likeWallet).where('chain', '==', 'base'));
      bookQuery.docs.forEach((doc) => {
        t.update(doc.ref, { ownerWallet: evmWallet });
      });
    });
    await db.runTransaction(async (t: admin.firestore.Transaction) => {
      const bookQuery = await t.get(likeNFTBookCollection.where(`connectedWallets.${likeWallet}`, '>', 0));
      bookQuery.docs.forEach((doc) => {
        // TODO: change .where to filter evm class id
        if (isEVMClassId(doc.id)) {
          const {
            connectedWallets,
          } = doc.data();
          const ratio = connectedWallets[likeWallet];
          delete connectedWallets[likeWallet];
          connectedWallets[evmWallet] = ratio;
          t.update(doc.ref, { connectedWallets });
        }
      });
    });
    return { error: null };
  } catch (error) {
  // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

async function migrateLikerId(likeWallet:string, evmWallet: string, method: 'manual' | 'auto' = 'manual') {
  try {
    const likerId = await db.runTransaction(async (t: admin.firestore.Transaction) => {
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
      t.update(userDoc.ref, {
        evmWallet,
        migrateMethod: method,
      });
      return userDoc.id;
    });

    // Update Intercom user with new EVM wallet
    if (likerId) {
      await updateIntercomUserEvmWallet({
        userId: likerId,
        evmWallet,
      });
    }

    return { likerId, error: null };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { likerId: null, error: (error as Error).message };
  }
}

export async function migrateBookClassId(likeClassId: string, evmClassId: string) {
  try {
    const evmData = await getNFTClassDataById(evmClassId);
    if (evmData?.likecoin?.classId !== likeClassId) {
      throw new Error('EVM_CLASS_ID_NOT_MATCH_LIKE_CLASS_ID');
    }
    const res = await db.runTransaction(async (t: admin.firestore.Transaction) => {
      const migratedClassIds: string[] = [];
      const migratedClassDatas: any[] = [];
      const [bookListingDoc, bookTransactionQuery] = await Promise.all([
        t.get(likeNFTBookCollection.doc(likeClassId)),
        t.get(likeNFTBookCollection.doc(likeClassId)
          .collection('transactions')
          .where('status', '!=', 'new')),
      ]);
      if (bookListingDoc.exists) {
        const bookListingData = bookListingDoc.data();
        if (!bookListingData) throw new Error('BOOK_LISTING_NOT_FOUND');
        const {
          evmClassId: existingEVMClassId,
          ownerWallet,
          connectedWallets,
        } = bookListingData;
        if (!existingEVMClassId) {
          let newOwnerWallet = ownerWallet;
          if (ownerWallet && isValidLikeAddress(ownerWallet)) {
            const evmWallet = await checkBookUserEVMWallet(ownerWallet);
            if (evmWallet) {
              const ratio = connectedWallets?.[ownerWallet];
              if (ratio) {
                delete connectedWallets[ownerWallet];
                connectedWallets[evmWallet] = ratio;
              }
              newOwnerWallet = evmWallet;
            }
          }
          const migratedData: any = {
            ...bookListingData,
            chain: 'base',
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
          bookTransactionQuery.docs.forEach((doc) => {
            t.create(likeNFTBookCollection.doc(evmClassId)
              .collection('transactions')
              .doc(doc.id), {
              ...doc.data(),
              classId: evmClassId,
              likeClassId,
              migrateTimestamp: FieldValue.serverTimestamp(),
            });
          });
          migratedClassIds.push(likeClassId);
          migratedClassDatas.push(migratedData);
        }
      }
      return {
        migratedClassIds,
        migratedClassDatas,
      };
    });
    for (const classData of res.migratedClassDatas) {
      const {
        ownerWallet,
        hideDownload,
        prices,
        isHidden = false,
      } = classData;
      const metadata = await getNFTClassDataById(evmClassId);
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
        .map((p, index) => createStripeProductFromNFTBookPrice(evmClassId, index, {
          bookInfo: classData,
          price: p,
        })));
      await likeNFTBookCollection.doc(evmClassId).update({
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
        id: evmClassId,
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
        isHidden,
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
    } = res;
    return {
      error: null,
      migratedClassIds,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return { error: (error as Error).message };
  }
}

export async function migrateLikeUserToEVMUser(likeWallet: string, evmWallet: string, method: 'manual' | 'auto' = 'manual') {
  const { error: migrateBookUserError } = await migrateBookUser(likeWallet, evmWallet, method);
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
    migrateLikerId(likeWallet, evmWallet, method),
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

export async function migrateLikeWalletToEVMWallet(likeWallet: string, evmWallet: string, method: 'manual' | 'auto' = 'manual') {
  const { error: migrateBookUserError } = await migrateBookUser(likeWallet, evmWallet, method);
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
    migrateLikerId(likeWallet, evmWallet, method),
    migrateLikerLandEVMWallet(likeWallet, evmWallet),
  ]);
  return {
    isMigratedBookUser: !migrateBookUserError,
    isMigratedBookOwner: !migrateBookOwnerError,
    isMigratedLikerId: !migrateLikerIdError,
    isMigratedLikerLand: !migrateLikerLandError,
    migratedLikerId: likerId,
    migratedLikerLandUser: likerLandUser,
    migrateBookUserError,
    migrateBookOwnerError,
    migrateLikerIdError,
    migrateLikerLandError,
  };
}

export default findLikeWalletByEVMWallet;
