import { Router } from 'express';
import { isValidLikeAddress } from '../../util/cosmos';
import { getUserStat } from '../../util/api/likernft/user';
import { ValidationError } from '../../util/ValidationError';
import { ONE_DAY_IN_S } from '../../constant';

const router = Router();

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
