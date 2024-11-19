import { v4 as uuidv4 } from 'uuid';
import { FieldValue, db, likeNFTCollectionCollection } from '../../../firebase';
import { filterNFTCollection } from '../../../ValidationHelper';
import { ValidationError } from '../../../ValidationError';
import {
  validateAutoDeliverNFTsTxHashV2, validatePrice, getLocalizedTextWithFallback,
} from '../book';
import { getISCNFromNFTClassId, getNFTsByClassId } from '../../../cosmos/nft';
import { sleep } from '../../../misc';
import { FIRESTORE_BATCH_SIZE, LIKER_LAND_HOSTNAME } from '../../../../constant';
import stripe from '../../../stripe';
import { parseImageURLFromMetadata } from '../metadata';
import { importGoogleRetailProductFromCollection } from '../../../googleRetail';

export type CollectionType = 'book' | 'reader' | 'creator';
export const COLLECTION_TYPES: CollectionType[] = ['book', 'reader', 'creator'];

export async function getLatestNFTCollection(type?: CollectionType) {
  let query: any = likeNFTCollectionCollection;
  if (type) query = query.where('type', '==', type);
  const res = await query.orderBy('timestamp', 'desc').get();
  return res.docs.map((doc) => ({ id: doc.id, ...filterNFTCollection(doc.data()) }));
}

export async function getNFTCollectionById(
  collectionId: string,
) {
  const doc = await likeNFTCollectionCollection.doc(collectionId).get();
  const docData = doc.data();
  if (!docData) {
    throw new ValidationError('COLLECTION_NOT_FOUND', 404);
  }
  return docData;
}

export async function getNFTCollectionsByOwner(
  wallet: string,
  isOwner: boolean,
  type?: CollectionType,
) {
  let query: any = likeNFTCollectionCollection.where('ownerWallet', '==', wallet);
  if (type) query = query.where('type', '==', type);
  const res = await query.get();
  return res.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...filterNFTCollection(docData, isOwner) };
  });
}

export async function getNFTCollectionsByClassId(
  classId: string,
  wallet?: string,
  type?: CollectionType,
) {
  let query: any = likeNFTCollectionCollection.where(
    'classIds',
    'array-contains',
    classId,
  );
  if (type) query = query.where('type', '==', type);
  const res = await query.get();
  return res.docs.map((doc) => {
    const docData = doc.data();
    const isOwner = docData.ownerWallet === wallet;
    return { id: doc.id, ...filterNFTCollection(docData, isOwner) };
  });
}

async function validateCollectionTypeData(
  wallet: string,
  type: CollectionType,
  data,
) {
  const { classIds = [], name, description } = data;
  if (!classIds.length) throw new ValidationError('INVALID_NFT_CLASS_IDS');
  if (!name) throw new ValidationError('INVALID_NAME');
  if (!description) throw new ValidationError('INVALID_DESCRIPTION');
  let typePayload: any = {};
  if (type === 'book') {
    // check book collection list valid, e.g. wallet own all nft classes
    const {
      autoMemo,
      priceInDecimal,
      stock,
      successUrl,
      cancelUrl,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      isAllowCustomPrice,
      isPhysicalOnly,
      hasShipping,
      shippingRates,
      isAutoDeliver,
      isUnlisted,
    } = data;
    validatePrice({
      priceInDecimal,
      stock,
      name,
      description,
      isAllowCustomPrice,
      isPhysicalOnly,
      hasShipping,
    });
    await Promise.all(
      classIds.map(async (classId) => {
        const result = await getISCNFromNFTClassId(classId)
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(err);
            return null;
          });
        if (!result) throw new ValidationError(`CLASS_ID_NOT_FOUND: ${classId}`);
        // Skip ISCN owner check
        // const { owner: ownerWallet } = result;
        // if (ownerWallet !== wallet) {
        //   throw new ValidationError(`NOT_OWNER_OF_NFT_CLASS: ${classId}`, 403);
        // }
        if (!isAutoDeliver) {
          const { nfts } = await getNFTsByClassId(classId, wallet);
          if (nfts.length < stock) {
            throw new ValidationError(`NOT_ENOUGH_NFT_COUNT: ${classId}`, 403);
          }
        }
      }),
    );
    typePayload = JSON.parse(
      JSON.stringify({
        // remove undefined
        successUrl,
        cancelUrl,
        priceInDecimal,
        stock,
        notificationEmails,
        moderatorWallets,
        connectedWallets,
        isAllowCustomPrice,
        isPhysicalOnly,
        hasShipping,
        shippingRates,
        autoMemo,
        isAutoDeliver,
        isUnlisted,
      }),
    );
  } else if (type === 'reader') {
    // check reader collection list valid, e.g. wallet own one instance of each nft
    throw new ValidationError('NOT_IMPLEMENTED_YET');
  } else if (type === 'creator') {
    // check wnft creator collection list valid, e.g. all nft class are owned by wallet
    throw new ValidationError('NOT_IMPLEMENTED_YET');
  }
  return typePayload;
}

function calculateExpectedNFTCountMap(
  oldClassIds: string[],
  oldStock: number,
  newClassIds: string[],
  newStock: number,
): { [classId: string]: number } {
  const map = {};
  const stockDiff = newStock - oldStock;
  const addedClassIds = newClassIds.filter((classId) => !oldClassIds.includes(classId));
  oldClassIds.forEach((classId) => {
    map[classId] = stockDiff;
  });
  addedClassIds.forEach((classId) => {
    map[classId] = newStock;
  });
  return map;
}

export async function createNFTCollectionByType(
  wallet: string,
  type: CollectionType,
  payload,
) {
  const collectionId = `col_${type}_${uuidv4()}`;
  const typePayload = await validateCollectionTypeData(wallet, type, payload);
  const {
    classIds = [],
    name,
    description,
    image,
    isAutoDeliver,
    autoDeliverNFTsTxHash,
    stock,
    hasShipping,
  } = payload;
  const docRef = likeNFTCollectionCollection.doc(collectionId);

  const images: string[] = [];
  if (image) {
    images.push(parseImageURLFromMetadata(image));
  }
  const stripeProduct = await stripe.products.create({
    name: getLocalizedTextWithFallback(name, 'zh'),
    description: getLocalizedTextWithFallback(description, 'zh') || undefined,
    id: collectionId,
    images,
    shippable: hasShipping,
    default_price_data: {
      currency: 'usd',
      unit_amount: typePayload.priceInDecimal,
    },
    url: `https://${LIKER_LAND_HOSTNAME}/nft/collection/${collectionId}`,
    metadata: {
      collectionId,
    },
  });
  const stripeProductId = stripeProduct.id;
  const stripePriceId = stripeProduct.default_price;

  let batch = db.batch();
  batch.create(docRef, {
    ownerWallet: wallet,
    classIds,
    name,
    description,
    image,
    type,
    typePayload: {
      sold: 0,
      stripeProductId,
      stripePriceId,
      ...typePayload,
    },
    timestamp: FieldValue.serverTimestamp(),
    lastUpdatedTimestamp: FieldValue.serverTimestamp(),
  });

  if (isAutoDeliver && stock > 0) {
    const expectedNFTCountMap = calculateExpectedNFTCountMap(
      [],
      0,
      classIds,
      stock,
    );
    const classIdToNFTIdsMap = await validateAutoDeliverNFTsTxHashV2({
      txHash: autoDeliverNFTsTxHash,
      sender: wallet,
      expectedNFTCountMap,
    });

    const flattenedEntries = Object.entries(classIdToNFTIdsMap).reduce(
      (acc, [classId, nftIds]) => {
        (nftIds as any[]).forEach((nftId) => {
          acc.push({ classId, nftId });
        });
        return acc;
      },
      [] as any[],
    );

    for (let i = 0; i < flattenedEntries.length; i += 1) {
      if ((i + 1) % FIRESTORE_BATCH_SIZE === 0) {
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
        // TODO: remove this after solving API CPU hang error
        await sleep(10);
        batch = db.batch();
      }
      const { classId, nftId } = flattenedEntries[i];
      batch.set(
        likeNFTCollectionCollection
          .doc(collectionId)
          .collection('class')
          .doc(classId)
          .collection('nft')
          .doc(nftId),
        {
          nftId,
          classId,
          isSold: false,
          isProcessing: false,
          timestamp: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  await batch.commit();

  const createdDoc = await docRef.get();
  const createdDocData = createdDoc.data();

  try {
    await importGoogleRetailProductFromCollection(filterNFTCollection({
      id: collectionId,
      ...createdDocData,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  return {
    id: collectionId,
    ownerWallet: wallet,
    classIds,
    name,
    description,
    image,
    type,
    typePayload,
    timestamp: createdDocData.timestamp,
  };
}

export async function patchNFTCollectionById(
  collectionId: string,
  wallet: string,
  payload,
) {
  const doc = await likeNFTCollectionCollection.doc(collectionId).get();
  const docData = doc.data();
  if (!docData) {
    throw new ValidationError('COLLECTION_NOT_FOUND', 404);
  }
  const {
    ownerWallet,
    type,
    typePayload,
    name: docName,
    description: docDescription,
    classIds: docClassIds,
  } = docData;
  if (ownerWallet !== wallet) { throw new ValidationError('NOT_OWNER_OF_COLLECTION', 403); }
  const {
    stock,
    isAutoDeliver,
    stripeProductId,
    stripePriceId,
  } = typePayload;
  const {
    classIds: newClassIds,
    name: newName,
    description: newDescription,
    image,
    stock: newStock,
    isAutoDeliver: newIsAutoDeliver,
    autoDeliverNFTsTxHash,
  } = payload;

  if (isAutoDeliver) {
    if (!newIsAutoDeliver) {
      throw new ValidationError('CANNOT_CHANGE_DELIVERY_METHOD_OF_AUTO_DELIVER_COLLECTION', 403);
    }

    if (newStock < stock) {
      throw new ValidationError('CANNOT_DECREASE_STOCK_OF_AUTO_DELIVERY_COLLECTION', 403);
    }

    const someDocClassIdNotIncluded = docClassIds.some((classId) => !newClassIds.includes(classId));
    if (someDocClassIdNotIncluded) {
      throw new ValidationError('CANNOT_REMOVE_CLASS_ID_OF_AUTO_DELIVERY_COLLECTION', 403);
    }
  }

  const newTypePayload = await validateCollectionTypeData(wallet, type, {
    name: newName || docName,
    description: newDescription || docDescription,
    classIds: newClassIds || docClassIds,
    ...typePayload,
    ...payload,
  });
  const updateTypePayload = {
    ...typePayload,
    ...newTypePayload,
  };
  const updatePayload: any = {
    typePayload: updateTypePayload,
    lastUpdatedTimestamp: FieldValue.serverTimestamp(),
  };
  if (newClassIds !== undefined) updatePayload.classIds = newClassIds;
  if (newName !== undefined) updatePayload.name = newName;
  if (newDescription !== undefined) updatePayload.description = newDescription;
  if (image !== undefined) updatePayload.image = image;

  if (stripeProductId) {
    if (newName || newDescription || image) {
      await stripe.products.update(stripeProductId, {
        name: getLocalizedTextWithFallback(newName || docName, 'zh'),
        description: getLocalizedTextWithFallback(newDescription || docDescription, 'zh'),
        images: image ? [parseImageURLFromMetadata(image)] : undefined,
      });
    }
    if (stripePriceId) {
      if (typePayload.priceInDecimal !== newTypePayload.priceInDecimal) {
        const newStripePrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: newTypePayload.priceInDecimal,
          currency: 'usd',
        });
        await stripe.prices.update(stripePriceId, {
          active: false,
        });
        updatePayload.typePayload.stripePriceId = newStripePrice.id;
      }
    }
  }

  let batch = db.batch();
  batch.update(likeNFTCollectionCollection.doc(collectionId), updatePayload);

  try {
    await importGoogleRetailProductFromCollection(
      filterNFTCollection({ id: collectionId, ...docData, ...updatePayload }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  if (newIsAutoDeliver) {
    const expectedNFTCountMap = calculateExpectedNFTCountMap(
      docClassIds,
      isAutoDeliver ? stock : 0,
      newClassIds,
      newStock,
    );
    const shouldUpdateNFTId = Object.values(expectedNFTCountMap).some((count) => count > 0);
    if (shouldUpdateNFTId) {
      const classIdToNFTIdsMap = await validateAutoDeliverNFTsTxHashV2({
        txHash: autoDeliverNFTsTxHash,
        sender: wallet,
        expectedNFTCountMap,
      });

      const flattenedEntries = Object.entries(classIdToNFTIdsMap).reduce(
        (acc, [classId, nftIds]) => {
          (nftIds as any[]).forEach((nftId) => {
            acc.push({ classId, nftId });
          });
          return acc;
        },
        [] as any[],
      );
      for (let i = 0; i < flattenedEntries.length; i += 1) {
        if ((i + 1) % FIRESTORE_BATCH_SIZE === 0) {
          // eslint-disable-next-line no-await-in-loop
          await batch.commit();
          // TODO: remove this after solving API CPU hang error
          await sleep(10);
          batch = db.batch();
        }
        const { classId, nftId } = flattenedEntries[i];
        batch.set(
          likeNFTCollectionCollection
            .doc(collectionId)
            .collection('class')
            .doc(classId)
            .collection('nft')
            .doc(nftId),
          {
            nftId,
            classId,
            isSold: false,
            isProcessing: false,
            timestamp: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }
  }

  await batch.commit();
}

export async function removeNFTCollectionById(
  collectionId: string,
  wallet: string,
) {
  const doc = await likeNFTCollectionCollection.doc(collectionId).get();
  const docData = doc.data();
  if (!docData) {
    throw new ValidationError('COLLECTION_NOT_FOUND', 404);
  }
  const { ownerWallet, typePayload = {} } = docData;
  if (ownerWallet !== wallet) { throw new ValidationError('NOT_OWNER_OF_COLLECTION', 403); }
  const { stripeProductId, stripePriceId } = typePayload;
  if (stripePriceId) {
    await stripe.prices.update(stripePriceId, {
      active: false,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
    });
  }
  if (stripeProductId) {
    await stripe.products.del(stripeProductId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
    });
  }
  await likeNFTCollectionCollection.doc(collectionId).delete();
}
