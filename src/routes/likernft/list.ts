import { Router } from 'express';
import { ONE_DAY_IN_S } from '../../constant';
import { likeNFTCollection } from '../../util/firebase';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import { LikernftFreeListResponseSchema } from '../../util/api/likernft/schemas';

const router = Router();

router.get(
  '/list/free',
  async (req, res, next) => {
    try {
      let list: any[] = [];
      const query = await likeNFTCollection.where('currentPrice', '==', 0)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();
      list = query.docs
        .map((d) => d.data())
        .filter((d) => !d.collectExpiryAt || d.collectExpiryAt > Date.now())
        .map((d) => d.classId);
      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      sendValidatedJSON(res, LikernftFreeListResponseSchema, {
        list,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
