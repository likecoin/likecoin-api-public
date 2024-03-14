import { Router } from 'express';

import {
  CMC_API_CACHE_S,
} from '../../../config/config';
import { ValidationError } from '../../util/ValidationError';
import { getLIKEPrice } from '../../util/api/likernft/likePrice';
import { ONE_DAY_IN_S } from '../../constant';

const router = Router();

const CACHE_IN_S = CMC_API_CACHE_S || 300; // Rate limit: 333 per day ~ 1 per 259s

router.get('/price', async (req, res) => {
  const { currency = 'usd' } = req.query;
  if (currency !== 'usd') {
    throw new ValidationError('Unsupported currency.');
  }
  const price = await getLIKEPrice({ raw: true });
  res.set('Cache-Control', `public, max-age=${CACHE_IN_S}, s-maxage=${CACHE_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send({ price });
});

export default router;
