import { likeNFTCollectionCollection } from '../../../firebase';
import { filterNFTCollection } from '../../../ValidationHelper';

import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../../config/config';
import { ValidationError } from '../../../ValidationError';
import { getNFTCollectionById } from '.';

export async function getBookCollectionInfoById(collectionId: string) {
  const docData = await getNFTCollectionById(collectionId);
  const {
    type,
    typePayload,
  } = docData;
  if (type !== 'book') {
    throw new ValidationError('INVALID_COLLECTION_TYPE', 400);
  }
  return { ...docData, ...typePayload };
}

export async function listBookCollectionsInfoByModeratorWallet(moderatorWallet: string) {
  const MAX_BOOK_ITEMS_LIMIT = 256;
  const query = LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(moderatorWallet)
    ? await likeNFTCollectionCollection.limit(MAX_BOOK_ITEMS_LIMIT).get()
    : await likeNFTCollectionCollection.where('typePayload.moderatorWallets', 'array-contains', moderatorWallet).limit(MAX_BOOK_ITEMS_LIMIT).get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    const isOwner = docData.ownerWallet === moderatorWallet;
    return { id: doc.id, ...filterNFTCollection(docData, isOwner) };
  });
}
