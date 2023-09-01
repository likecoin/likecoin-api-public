import axios from 'axios';
import { Router } from 'express';

import {
  COINGECKO_PRICE_URL,
  LIKE_DEFAULT_PRICE,
} from '../../constant';
import {
  CMC_API_CACHE_S,
} from '../../../config/config';

const router = Router();

const CACHE_IN_S = CMC_API_CACHE_S || 300; // Rate limit: 333 per day ~ 1 per 259s

router.get('/price', async (req, res) => {
  const { currency = 'usd' } = req.query;
  let price;
  try {
    const prices = await Promise.all([
      axios.get(COINGECKO_PRICE_URL)
        .then((r) => r.data.market_data.current_price[currency as string])
        .catch(() => undefined),
    ]);
    // eslint-disable-next-line no-restricted-globals
    const validPrices = prices.filter((p) => !isNaN(p));
    if (!validPrices.length) {
      if (currency !== 'usd') throw new Error('Failed to get price.');
      price = LIKE_DEFAULT_PRICE;
    } else {
      price = Math.max(...validPrices);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  if (!price) {
    res.sendStatus(500);
    return;
  }
  res.set('Cache-Control', `public, max-age=${CACHE_IN_S}, s-maxage=${CACHE_IN_S}, stale-if-error=${CACHE_IN_S}`);
  res.send({ price });
});

export default router;
