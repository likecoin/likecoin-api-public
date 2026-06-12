import { Router } from 'express';
import { isValidLikeAddress } from '../../util/cosmos';
import { getUserStat } from '../../util/api/likernft/user';
import { ValidationError } from '../../util/ValidationError';
import { ONE_DAY_IN_S } from '../../constant';
import { validateParams } from '../../middleware/validate';
import { LikernftUserStatsParamsSchema, LikernftUserStatResponseSchema } from '../../util/api/likernft/schemas';
import { sendValidatedJSON } from '../../util/ValidationHelper';

const router = Router();

router.get(
  '/user/:wallet/stats',
  validateParams(LikernftUserStatsParamsSchema),
  async (req, res, next) => {
    try {
      const { wallet } = req.params;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');

      const userStat = await getUserStat(wallet);
      res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      sendValidatedJSON(res, LikernftUserStatResponseSchema, userStat);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
