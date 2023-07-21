import { Router } from 'express';
import { getSubscriptionUserActiveSubscriptionsData } from '../../../util/api/likernft/subscription/readers';
import { jwtAuth } from '../../../middleware/jwt';

const router = Router();

router.get(
  '/plans',
  jwtAuth('read:nft_reader'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const plans = await getSubscriptionUserActiveSubscriptionsData(wallet);
      res.json({ plans });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
