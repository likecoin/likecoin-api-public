import axios from 'axios';
import BigNumber from 'bignumber.js';

import { COINGECKO_PRICE_URL } from '../../../../constant';
import {
  LIKER_NFT_FIAT_FEE_USD,
  LIKER_NFT_FIAT_MIN_RATIO,
} from '../../../../../config/config';

const LRU = require('lru-cache');

const priceCache = new LRU({ max: 1, maxAge: 10 * 60 * 1000 }); // 10 min
const CURRENCY = 'usd';

async function getLIKEPrice() {
  const cachedPrice = priceCache.get(CURRENCY);
  if (cachedPrice) {
    return cachedPrice;
  }
  const price = await Promise.all([
    axios.get(COINGECKO_PRICE_URL)
      .then((r) => {
        const p = r.data.market_data.current_price[CURRENCY];
        priceCache.set(CURRENCY, p);
        return p;
      })
      .catch(() => LIKER_NFT_FIAT_MIN_RATIO),
  ]);
  return Math.min(price || LIKER_NFT_FIAT_MIN_RATIO);
}

export async function getFiatPriceForLIKE(LIKE, { buffer = 0.1 }) {
  const rate = await getLIKEPrice();
  const price = new BigNumber(LIKE).multipliedBy(rate).multipliedBy(1 + buffer);
  const total = price.plus(LIKER_NFT_FIAT_FEE_USD).toFixed(2);
  return Number(total);
}

export async function checkFiatPriceForLIKE(fiat, targetLIKE) {
  const rate = await getLIKEPrice();
  const targetPrice = new BigNumber(targetLIKE).multipliedBy(rate);
  const targetTotal = targetPrice.plus(LIKER_NFT_FIAT_FEE_USD).toFixed(2);
  return targetTotal.lte(fiat);
}
