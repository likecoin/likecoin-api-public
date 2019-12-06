import axios from 'axios';
import { Router } from 'express';

import {
  COINGECKO_PRICE_URL,
  COINMARKETCAP_PRICE_URL,
  LIKE_DEFAULT_PRICE,
} from '../../constant';
import {
  CMC_PRO_API_KEY,
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
        .then(r => r.data.market_data.current_price[currency])
        .catch(() => undefined),
      axios.get(`${COINMARKETCAP_PRICE_URL}?symbol=LIKE&convert=${currency.toUpperCase()}`, {
        headers: {
          'X-CMC_PRO_API_KEY': CMC_PRO_API_KEY,
        },
      }).then(r => parseFloat(r.data.LIKE.quote[currency].price))
        .catch(() => undefined),
    ]);
    const validPrices = prices.filter(p => !isNaN(p)); // eslint-disable-line no-restricted-globals
    if (!validPrices.length) {
      if (currency !== 'usd') throw new Error('Failed to get price.');
      price = LIKE_DEFAULT_PRICE;
    } else {
      price = Math.max(...validPrices);
    }
  } catch (err) {
    console.error(err);
  }
  if (price === undefined) {
    res.sendStatus(500);
    return;
  }
  res.set('Cache-Control', `public, max-age=${CACHE_IN_S}, s-maxage=${CACHE_IN_S}, stale-if-error=${CACHE_IN_S}`);
  res.send({ price });
});

export default router;
