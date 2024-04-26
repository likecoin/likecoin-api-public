import { v4 as uuidv4 } from 'uuid';
import { FieldValue, likeNFTCollectionCollection } from '../../../firebase';
import { filterNFTCollection } from '../../../ValidationHelper';
import { ValidationError } from '../../../ValidationError';
import { validateCoupons, validatePrice } from '../book';
import { getISCNFromNFTClassId, getNFTsByClassId } from '../../../cosmos/nft';

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
      priceInDecimal,
      stock,
      successUrl,
      cancelUrl,
      defaultPaymentCurrency,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      coupons,
      isAllowCustomPrice,
      isPhysicalOnly,
      hasShipping,
      shippingRates,
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
    if (coupons?.length) validateCoupons(coupons);
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
        const { nfts } = await getNFTsByClassId(classId, wallet);
        if (nfts.length < stock) {
          throw new ValidationError(`NOT_ENOUGH_NFT_COUNT: ${classId}`, 403);
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
        defaultPaymentCurrency,
        notificationEmails,
        moderatorWallets,
        connectedWallets,
        coupons,
        isAllowCustomPrice,
        isPhysicalOnly,
        hasShipping,
        shippingRates,
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

export async function createNFTCollectionByType(
  wallet: string,
  type: CollectionType,
  payload,
) {
  const collectionId = `col_${type}_${uuidv4()}`;
  const typePayload = await validateCollectionTypeData(wallet, type, payload);
  const {
    classIds = [], name, description, image,
  } = payload;
  const docRef = likeNFTCollectionCollection.doc(collectionId);
  await docRef.create({
    ownerWallet: wallet,
    classIds,
    name,
    description,
    image,
    type,
    typePayload: {
      sold: 0,
      ...typePayload,
    },
    timestamp: FieldValue.serverTimestamp(),
    lastUpdatedTimestamp: FieldValue.serverTimestamp(),
  });
  const createdDoc = await docRef.get();
  const createdDocData = createdDoc.data();
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
    classIds: newClassIds,
    name: newName,
    description: newDescription,
    image,
  } = payload;

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
  await likeNFTCollectionCollection.doc(collectionId).update(updatePayload);
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
  const { ownerWallet } = docData;
  if (ownerWallet !== wallet) { throw new ValidationError('NOT_OWNER_OF_COLLECTION', 403); }
  await likeNFTCollectionCollection.doc(collectionId).delete();
}
