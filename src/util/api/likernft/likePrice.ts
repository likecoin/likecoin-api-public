import axios from 'axios';
import LRU from 'lru-cache';
// eslint-disable-next-line import/no-extraneous-dependencies
import { LIKER_NFT_FIAT_MIN_RATIO } from '../../../../config/config';
import { COINGECKO_PRICE_URL } from '../../../constant';

const priceCache = new LRU({ max: 1, maxAge: 1 * 60 * 1000 }); // 1 min
const CURRENCY = 'usd';

export async function getLIKEPrice() {
  const hasCache = priceCache.has(CURRENCY);
  const cachedPrice = priceCache.get(CURRENCY, { allowStale: true });
  let price;
  if (hasCache) {
    price = cachedPrice;
  } else {
    try {
      const { data } = await axios.get(COINGECKO_PRICE_URL);
      const p = data.market_data.current_price[CURRENCY];
      priceCache.set(CURRENCY, p);
      price = p;
    } catch (error) {
      price = cachedPrice || LIKER_NFT_FIAT_MIN_RATIO;
    }
  }
  return Math.max(price || LIKER_NFT_FIAT_MIN_RATIO);
}

export default getLIKEPrice();
