import { Router } from 'express';
import { db, likeNFTCollection } from '../../util/firebase';
import { isValidLikeAddress } from '../../util/cosmos';
import { ValidationError } from '../../util/ValidationError';


const router = Router();

router.get(
  '/user/:wallet/sell',
  async (req, res, next) => {
    try {
      const { wallet } = req.params;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const [sellingNftsQuery, createdClassesQuery] = await Promise.all([
        db.collectionGroup('nft')
          .where('sellerWallet', '==', wallet)
          .where('soldCount', '>', 0).get(),
        // TODO: what if iscn owner changed?
        likeNFTCollection.where('ownerWallet', '==', wallet).get(),
      ]);
      const classIdSet = new Set();
      sellingNftsQuery.docs.forEach((doc) => {
        classIdSet.add(doc.data().classId);
      });
      createdClassesQuery.docs.forEach((doc) => {
        classIdSet.add(doc.data().classId);
      });
      res.json({
        list: Array.from(classIdSet),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
