import axios from 'axios';
import LRU from 'lru-cache';
import { BigNumber } from 'bignumber.js';
import { LIKER_NFT_FIAT_MIN_RATIO } from '../../../../config/config';
import { COINGECKO_AR_LIKE_PRICE_API } from '../../../constant';

const priceCache = new LRU({ max: 1, maxAge: 1 * 60 * 1000 }); // 1 min
const FIAT_CURRENCY = 'usd';

function getKey(fromToken, toToken) {
  return `${fromToken}_${toToken}`;
}

async function getTokenPrice(fromToken, toToken, fallback) {
  const key = getKey(fromToken, toToken);
  const hasCache = priceCache.has(key);
  const cachedPrice = priceCache.get(key, { allowStale: true });
  let price;
  if (hasCache) {
    price = cachedPrice;
  } else {
    try {
      const { data } = await axios.get(COINGECKO_AR_LIKE_PRICE_API);
      let p = data[fromToken][FIAT_CURRENCY];
      if (toToken !== FIAT_CURRENCY) {
        const r = data[toToken][FIAT_CURRENCY];
        p = new BigNumber(p).dividedBy(r).toNumber();
      }
      priceCache.set(key, p);
      price = p;
    } catch (error) {
      price = cachedPrice || fallback;
    }
  }
  return price;
}

export async function getLIKEPrice({ raw = false } = {}) {
  const token = 'likecoin';
  const price = await getTokenPrice(token, FIAT_CURRENCY, LIKER_NFT_FIAT_MIN_RATIO);
  return raw ? price : Math.max(price || LIKER_NFT_FIAT_MIN_RATIO);
}

export async function getMaticPriceInLIKE() {
  const price = await getTokenPrice('matic-network', 'likecoin', 700);
  return price;
}

export async function getArweavePriceInLIKE() {
  const price = await getTokenPrice('arweave', 'likecoin', 5000);
  return price;
}

export default getLIKEPrice();
