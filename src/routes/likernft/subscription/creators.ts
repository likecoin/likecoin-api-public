import { Router } from 'express';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth } from '../../../middleware/jwt';
import {
  MIN_SUBSCRIPTION_PLAN_PRICE_DECIMAL,
  NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE,
  getCreatorSubscriptionPlan,
  getCreatorSubscriptionPlans,
  newCreatorSubscriptionPlan,
} from '../../../util/api/likernft/subscription/creators';
import { filterNFTSubscriptionPlanInfo } from '../../../util/ValidationHelper';

const router = Router();

router.get(
  '/:wallet/plans',
  async (req, res, next) => {
    try {
      const { wallet } = req.params;
      const plansInfo = await getCreatorSubscriptionPlans(wallet);
      const plans = plansInfo.map((p) => filterNFTSubscriptionPlanInfo(p));
      res.json({ plans });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:wallet/plans/:planId',
  async (req, res, next) => {
    try {
      const { wallet, planId } = req.params;
      const planInfo = await getCreatorSubscriptionPlan(wallet, planId);

      if (!planInfo) {
        res.status(404).send('PLAN_NOT_FOUND');
        return;
      }
      res.json(filterNFTSubscriptionPlanInfo(planInfo));
    } catch (err) {
      next(err);
    }
  },
);

router.post('/:wallet/plans', jwtAuth('write:nft_creator'), async (req, res, next) => {
  try {
    const { wallet: userWallet } = req.user;
    const { wallet } = req.params;
    if (userWallet !== wallet) {
      throw new ValidationError('USER_NOT_MATCH', 403);
    }
    const {
      priceInDecimal,
      description,
      name,
      canFreeMintWNFT,
    } = req.body;
    if (!(priceInDecimal > 0
        && (typeof priceInDecimal === 'number')
        && priceInDecimal >= MIN_SUBSCRIPTION_PLAN_PRICE_DECIMAL)) {
      throw new ValidationError('INVALID_PRICE');
    }
    if (!(
      typeof name[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE] === 'string'
        && Object.values(name).every((n) => typeof n === 'string')
        && (description[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE] && typeof description[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE] === 'string'))
        && Object.values(description).every((d) => typeof d === 'string')) {
      throw new ValidationError('INVALID_NAME_OR_DESCRIPTION');
    }
    const { stripePriceId, stripeProductId } = await newCreatorSubscriptionPlan(wallet, {
      priceInDecimal,
      name,
      description,
      canFreeMintWNFT,
    });
    res.json({ stripePriceId, stripeProductId });
  } catch (err) {
    next(err);
  }
});

export default router;
