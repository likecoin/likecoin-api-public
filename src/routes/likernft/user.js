import { Router } from 'express';
import { db, likeNFTCollection } from '../../util/firebase';
import { isValidLikeAddress } from '../../util/cosmos';
import { getNFTISCNOwner } from '../../util/cosmos/nft';
import { ValidationError } from '../../util/ValidationError';
import { ONE_DAY_IN_S } from '../../constant';


const router = Router();

router.get(
  '/user/:wallet/sell',
  async (req, res, next) => {
    try {
      const { wallet } = req.params;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const [sellingNftsQuery, ownedClassesQuery] = await Promise.all([
        db.collectionGroup('nft')
          .where('sellerWallet', '==', wallet)
          .where('soldCount', '>', 0).get(),
        likeNFTCollection.where('ownerWallet', '==', wallet).get(),
      ]);
      const classIdSet = new Set();
      ownedClassesQuery.docs.forEach((doc) => {
        classIdSet.add(doc.data().classId);
      });
      const batch = db.batch();
      const promises = ownedClassesQuery.docs.map(async (doc) => {
        const iscnPrefix = decodeURIComponent(doc.id);
        const owner = await getNFTISCNOwner(iscnPrefix);
        if (owner !== wallet) {
          classIdSet.delete(doc.data().classId);
          batch.update({ ownerWallet: owner });
        }
      });
      await Promise.all(promises);
      sellingNftsQuery.docs.forEach((doc) => {
        classIdSet.add(doc.data().classId);
      });
      res.set('Cache-Control', `public, max-age=60 s-maxage=60 stale-if-error=${ONE_DAY_IN_S}`);
      res.json({
        list: Array.from(classIdSet),
      });
      await batch.commit();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
