import axios from 'axios';
import { Router } from 'express';

import {
  COINGECKO_PRICE_URL,
  COINMARKETCAP_PRICE_URL,
  LIKE_DEFAULT_PRICE,
} from '../../constant';
import {
  CMC_PRO_API_KEY,
} from '../../../config/config';

const router = Router();

const CACHE_IN_S = 60;

router.get('/price', async (req, res) => {
  const { currency = 'usd' } = req.query;
  let price = currency === 'usd' ? LIKE_DEFAULT_PRICE : null;
  try {
    const prices = await Promise.all([
      axios.get(COINGECKO_PRICE_URL)
        .then(r => r.data.market_data.current_price[currency])
        .catch(() => 0),
      axios.get(`${COINMARKETCAP_PRICE_URL}?symbol=LIKE&convert=${currency.toUpperCase()}`, {
        headers: {
          'X-CMC_PRO_API_KEY': CMC_PRO_API_KEY,
        },
      }).then(r => parseFloat(r.data.LIKE.quote[currency].price))
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
