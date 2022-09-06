import axios from 'axios';
import BigNumber from 'bignumber.js';

import { db, likeNFTFiatCollection } from '../../../firebase';
import { COINGECKO_PRICE_URL } from '../../../../constant';
import { checkWalletGrantAmount, processNFTPurchase } from '../purchase';
import { getLikerNFTFiatSigningClientAndWallet } from '../../../cosmos/nft';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_FIAT_FEE_USD,
  LIKER_NFT_FIAT_MIN_RATIO,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../../config/config';
import { ValidationError } from '../../../ValidationError';

const LRU = require('lru-cache');

const priceCache = new LRU({ max: 1, maxAge: 10 * 60 * 1000 }); // 10 min
const CURRENCY = 'usd';

let fiatGranterWallet;

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
  return Math.max(price || LIKER_NFT_FIAT_MIN_RATIO);
}

export async function getFiatPriceStringForLIKE(LIKE, { buffer = 0.1 } = {}) {
  const rate = await getLIKEPrice();
  const price = new BigNumber(LIKE).multipliedBy(rate).multipliedBy(1 + buffer);
  const total = price.plus(LIKER_NFT_FIAT_FEE_USD).toFixed(2);
  return total;
}

export async function checkFiatPriceForLIKE(fiat, targetLIKE) {
  const rate = await getLIKEPrice();
  const targetPrice = new BigNumber(targetLIKE).multipliedBy(rate);
  const targetTotal = targetPrice.plus(LIKER_NFT_FIAT_FEE_USD);
  return targetTotal.lte(fiat);
}

export async function checkGranterFiatWalletGrant(targetAmount, grantAmount = 400000) {
  if (!fiatGranterWallet) {
    const { wallet } = await getLikerNFTFiatSigningClientAndWallet();
    fiatGranterWallet = wallet.address;
  }
  try {
    await checkWalletGrantAmount(fiatGranterWallet, LIKER_NFT_TARGET_ADDRESS, targetAmount);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const { client, wallet } = await getLikerNFTFiatSigningClientAndWallet();
    const res = await client.createSendGrant(
      wallet.address,
      LIKER_NFT_TARGET_ADDRESS,
      [{
        denom: NFT_COSMOS_DENOM,
        amount: new BigNumber(grantAmount).shiftedBy(9).toFixed(0),
      }],
      Date.now() + 2629743000, // one month,
    );
    // TODO: publish log
    // eslint-disable-next-line no-console
    console.log(res);
  }
}

export async function processFiatNFTPurchase({
  paymentId, likeWallet, iscnPrefix, classId, fiatPrice, LIKEPrice,
}, req) {
  const docRef = likeNFTFiatCollection.doc(paymentId);
  const isFiatEnough = await checkFiatPriceForLIKE(fiatPrice, LIKEPrice);
  if (!isFiatEnough) throw new ValidationError('FIAT_AMOUNT_NOT_ENOUGH');
  if (!fiatGranterWallet) {
    const { wallet } = await getLikerNFTFiatSigningClientAndWallet();
    fiatGranterWallet = wallet.address;
  }
  await checkGranterFiatWalletGrant(LIKEPrice);
  const isHandled = await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) throw new ValidationError('PAYMENT_ID_NOT_FOUND');
    const { status } = docData;
    if (status !== 'new') return true;
    t.update(docRef, { status: 'processing' });
    return false;
  });
  if (isHandled) return null;
  let res;
  try {
    res = await processNFTPurchase({
      buyerWallet: likeWallet,
      iscnPrefix,
      classId,
      granterWallet: fiatGranterWallet,
      grantedAmount: LIKEPrice,
    }, req);
  } catch (err) {
    await docRef.update({
      status: 'error',
      error: err.toString(),
      errorMessage: err.message,
      errorStack: err.stack,
    });
    throw err;
  }
  const {
    transactionHash,
    nftId,
    nftPrice: actualNftPrice,
  } = res;
  await docRef.update({
    transactionHash,
    nftId,
    actualNftPrice,
    status: 'done',
  });
  return res;
}

/* Make sure we have a grant on start up */
// eslint-disable-next-line no-console
if (!process.env.CI) try { checkGranterFiatWalletGrant(65536); } catch (err) { console.err(err); }
