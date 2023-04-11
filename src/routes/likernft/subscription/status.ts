import { Router } from 'express';

import { isValidLikeAddress } from '../../../util/cosmos';
import { ValidationError } from '../../../util/ValidationError';
import { checkUserIsActiveNFTSubscriber } from '../../../util/api/likernft/subscription';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
    const { isActive } = await checkUserIsActiveNFTSubscriber(wallet as string);
    res.json({ isActive });
  } catch (err) {
    next(err);
  }
});

export default router;
