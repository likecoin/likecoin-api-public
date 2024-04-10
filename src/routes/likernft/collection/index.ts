import { Router } from 'express';

import { isValidLikeAddress } from '../../../util/cosmos';
import { ValidationError } from '../../../util/ValidationError';
import {
  COLLECTION_TYPES,
  CollectionType,
  getNFTCollectionsByOwner,
  getLatestNFTCollection,
  getNFTCollectionsByClassId,
  createNFTCollectionByType,
  patchNFTCollectionById,
  removeNFTCollectionById,
  getNFTCollectionById,
} from '../../../util/api/likernft/collection';
import { filterNFTCollection } from '../../../util/ValidationHelper';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { createAirtablePublicationRecord } from '../../../util/airtable';

const router = Router();

router.get('/collection', jwtOptionalAuth('read:nftcollection'), async (req, res, next) => {
  try {
    const userWallet = req.user?.wallet;
    const { wallet, class_id: classId, type } = req.query;
    if (type && !COLLECTION_TYPES.includes(type as any)) {
      throw new ValidationError('INVALID_COLLECTION_TYPE');
    }
    if (wallet) {
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const list = await getNFTCollectionsByOwner(
        wallet as string,
        userWallet === wallet,
        type as CollectionType,
      );
      res.json({ list });
      return;
    }
    if (classId) {
      const list = await getNFTCollectionsByClassId(
        classId as string,
        userWallet,
        type as CollectionType,
      );
      res.json({ list });
      return;
    }
    const list = await getLatestNFTCollection(type as CollectionType);
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.get('/collection/:collectionId', jwtOptionalAuth('read:nftcollection'), async (req, res, next) => {
  try {
    const wallet = req.user?.wallet;
    const { collectionId } = req.params;
    const docData = await getNFTCollectionById(collectionId);
    const { ownerWallet } = docData;
    const isOwner = wallet === ownerWallet;
    res.json(filterNFTCollection(docData, isOwner));
  } catch (err) {
    next(err);
  }
});

router.post('/collection', jwtAuth('write:nftcollection'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const {
      type,
      ...payload
    } = req.body;
    if (!type || !COLLECTION_TYPES.includes(type as any)) {
      throw new ValidationError('INVALID_COLLECTION_TYPE');
    }
    const result = await createNFTCollectionByType(wallet as string, type, payload);

    const price = (result.typePayload?.priceInDecimal || 0) / 100;
    await createAirtablePublicationRecord({
      timestamp: new Date(result.timestamp),
      id: result.id,
      name: result.name,
      description: result.description,
      ownerWallet: result.ownerWallet,
      type: `col_${result.type}`,
      minPrice: price,
      maxPrice: price,
      imageURL: result.image,
      metadata: result,
    });

    res.json(filterNFTCollection(result, true));
  } catch (err) {
    next(err);
  }
});

router.patch('/collection/:id', jwtAuth('write:nftcollection'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const { id } = req.params;
    await patchNFTCollectionById(id, wallet, req.body);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.delete('/collection/:id', jwtAuth('write:nftcollection'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const { id } = req.params;
    await removeNFTCollectionById(id, wallet);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
