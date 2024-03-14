import { Router } from 'express';
import { db, likeNFTCollection } from '../../util/firebase';
import { isValidLikeAddress } from '../../util/cosmos';
import { filterOwnedClassIds, getUserStat } from '../../util/api/likernft/user';
import { ValidationError } from '../../util/ValidationError';
import { ONE_DAY_IN_S } from '../../constant';

const UPDATE_COOLDOWN = 60 * 1000;
const updateCooldownMap = {};

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
      const now = Date.now();
      if (!updateCooldownMap[wallet] || now - updateCooldownMap[wallet] > UPDATE_COOLDOWN) {
        updateCooldownMap[wallet] = now;
        const ownedClassIds = await filterOwnedClassIds(ownedClassesQuery.docs, wallet);
        ownedClassIds.forEach((classId) => classIdSet.add(classId));
      } else {
        ownedClassesQuery.docs.forEach((doc) => {
          classIdSet.add(doc.data().classId);
        });
      }
      sellingNftsQuery.docs.forEach((doc) => {
        classIdSet.add(doc.data().classId);
      });
      res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json({
        list: Array.from(classIdSet),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/user/:wallet/stats',
  async (req, res, next) => {
    try {
      const { wallet } = req.params;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');

      const userStat = await getUserStat(wallet);
      res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json(userStat);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
