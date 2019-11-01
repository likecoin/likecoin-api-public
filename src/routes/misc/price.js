import axios from 'axios';
import { Router } from 'express';

import {
  COINGECKO_PRICE_URL,
  COINMARKETCAP_PRICE_URL,
  LIKE_DEFAULT_PRICE,
} from '../../constant';

const router = Router();

const CACHE_IN_S = 30;

router.get('/price', async (req, res) => {
  const { currency = 'usd' } = req.query;
  let price = currency === 'usd' ? LIKE_DEFAULT_PRICE : null;
  try {
    const prices = await Promise.all([
      axios.get(COINGECKO_PRICE_URL)
        .then(r => r.data.market_data.current_price[currency])
        .catch(() => 0),
      axios.get(`${COINMARKETCAP_PRICE_URL}?convert=${currency}`)
        .then(r => parseFloat(r.data[0][`price_${currency}`]))
        .catch(() => 0),
    ]);
    price = Math.max(...prices);
  } catch (err) {
    console.error(err);
  }
  res.set('Cache-Control', `public, max-age=${CACHE_IN_S}, s-maxage=${CACHE_IN_S}, stale-if-error=${CACHE_IN_S}`);
  res.send({ price });
});

export default router;
