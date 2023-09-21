import axios from 'axios';
import BigNumber from 'bignumber.js';
import { DeliverTxResponse } from '@cosmjs/stargate';
import LRU from 'lru-cache';

import { db, likeNFTFiatCollection } from '../../../firebase';
import { COINGECKO_PRICE_URL, PUBSUB_TOPIC_MISC } from '../../../../constant';
import {
  checkWalletGrantAmount,
  getLatestNFTPriceAndInfo,
  processNFTPurchase,
} from '../purchase';
import { getLikerNFTFiatSigningClientAndWallet } from '../../../cosmos/nft';
import publisher from '../../../gcloudPub';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_STRIPE_FEE_USD_INTERCEPT,
  LIKER_NFT_STRIPE_FEE_USD_SLOPE,
  LIKER_NFT_FIAT_MIN_RATIO,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../../config/config';
import { ValidationError } from '../../../ValidationError';

const priceCache = new LRU({ max: 1, maxAge: 1 * 60 * 1000 }); // 1 min
const CURRENCY = 'usd';

let fiatGranterWallet;

async function getLIKEPrice() {
  const hasCache = priceCache.has(CURRENCY);
  const cachedPrice = priceCache.get(CURRENCY, { allowStale: true });
  let price;
  if (hasCache) {
    price = cachedPrice;
  } else {
    price = await axios.get(COINGECKO_PRICE_URL)
      .then((r) => {
        const p = r.data.market_data.current_price[CURRENCY];
        priceCache.set(CURRENCY, p);
        return p;
      })
      .catch(() => cachedPrice || LIKER_NFT_FIAT_MIN_RATIO);
  }
  return Math.max(price || LIKER_NFT_FIAT_MIN_RATIO);
}

export async function getPurchaseInfoList(iscnPrefixes, classIds) {
  const purchaseInfoList = await Promise.all(
    classIds.map(async (classId, i) => {
      const iscnPrefix = iscnPrefixes[i];
      const { price } = await getLatestNFTPriceAndInfo(iscnPrefix, classId);
      if (price < 0) throw new ValidationError(`NFT_${classId}_SOLD_OUT`);
      return {
        iscnPrefix,
        classId,
        price,
      };
    }),
  );
  return purchaseInfoList;
}

export async function calculatePayment(purchaseInfoList) {
  const rate = await getLIKEPrice();
  const totalLIKEPrice = Number(purchaseInfoList
    .reduce((acc, { price }) => acc.plus(price), new BigNumber(0))
    .dividedBy(rate)
    .toFixed(0, BigNumber.ROUND_UP));
  let totalFiatBigNum = purchaseInfoList
    .reduce((acc, { price }) => acc.plus(price), new BigNumber(0));
  let fiatTxFee = 0;
  if (totalFiatBigNum.gt(0)) {
    fiatTxFee = Number(totalFiatBigNum
      .times(LIKER_NFT_STRIPE_FEE_USD_SLOPE)
      .plus(LIKER_NFT_STRIPE_FEE_USD_INTERCEPT)
      .toFixed(2, BigNumber.ROUND_UP));
    totalFiatBigNum = totalFiatBigNum.plus(fiatTxFee);
  }
  const totalFiatPriceString = totalFiatBigNum.toFixed(2);
  return {
    totalLIKEPrice,
    totalFiatPriceString,
    fiatTxFee,
  };
}

export async function checkGranterFiatWalletGrant(targetAmount, grantAmount = 400000) {
  if (!fiatGranterWallet) {
    const res = await getLikerNFTFiatSigningClientAndWallet();
    if (!res) throw new Error('GRANT_FIAT_WALLET_NOT_SET');
    const { wallet } = res;
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
    publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'LikerNFTFiatWalletRegrant',
      targetAmount,
      grantAmount,
      txHash: (res as DeliverTxResponse).transactionHash,
      wallet: wallet.address,
      targetWallet: LIKER_NFT_TARGET_ADDRESS,
    });
  }
}

export async function processFiatNFTPurchase({
  paymentId,
  likeWallet,
  purchaseInfoList,
  LIKEPrice,
  fiatPrice,
  memo,
  email,
  claimToken,
}, req) {
  if (!fiatGranterWallet) {
    const { wallet } = await getLikerNFTFiatSigningClientAndWallet();
    fiatGranterWallet = wallet.address;
  }
  await checkGranterFiatWalletGrant(LIKEPrice);
  const docRef = likeNFTFiatCollection.doc(paymentId);
  const isHandled = await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const docData = doc.data();
    if (!docData) throw new ValidationError('PAYMENT_ID_NOT_FOUND');
    const { status } = docData;
    if (status !== 'new') return true;
    t.update(docRef, { status: 'processing' });
    return false;
  });
  if (isHandled) {
    // eslint-disable-next-line no-console
    console.log(`NFT Fiat Payment already handled ${paymentId}`);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentAlreadyHandled',
      paymentId,
      buyerWallet: likeWallet,
      buyerMemo: memo,
      purchaseInfoList,
      fiatPrice,
      LIKEPrice,
    });
    return null;
  }
  let res;
  try {
    const iscnPrefixes = purchaseInfoList.map(({ iscnPrefix }) => iscnPrefix);
    const classIds = purchaseInfoList.map(({ classId }) => classId);
    const { transactionHash, purchaseInfoList: _purchaseInfoList } = await processNFTPurchase({
      buyerWallet: likeWallet,
      iscnPrefixes,
      classIds,
      granterWallet: fiatGranterWallet,
      grantedAmount: LIKEPrice,
      grantTxHash: paymentId,
      granterMemo: memo,
    }, req);
    res = {
      transactionHash,
      purchaseInfoList: _purchaseInfoList,
    };
  } catch (err) {
    const error = (err as Error).toString();
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatPaymentPurchaseError',
      paymentId,
      buyerWallet: likeWallet,
      buyerMemo: memo,
      purchaseInfoList,
      fiatPrice,
      LIKEPrice,
      error,
      errorMessage,
      errorStack,
    });
    await docRef.update({
      status: 'error',
      error,
      errorMessage,
      errorStack,
    });
    throw err;
  }
  const {
    transactionHash,
  } = res;
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'LikerNFTFiatPaymentSuccess',
    paymentId,
    buyerWallet: likeWallet,
    buyerMemo: memo,
    purchaseInfoList,
    fiatPrice,
    LIKEPrice,
    transactionHash,
  });
  const purchaseInfoListToUpdate = res.purchaseInfoList.map(({ nftPrice, nftId }, i) => ({
    ...purchaseInfoList[i],
    actualNftPrice: nftPrice,
    nftId,
  }));
  const actualNftPrice = res.purchaseInfoList.reduce((acc, { nftPrice }) => acc + nftPrice, 0);
  await docRef.update({
    transactionHash,
    purchaseInfoList: purchaseInfoListToUpdate,
    actualNftPrice,
    claimToken: claimToken || null,
    status: claimToken ? 'pendingClaim' : 'done',
    email,
  });
  return res;
}

/* Make sure we have a grant on start up */
// eslint-disable-next-line no-console
if (!process.env.CI) checkGranterFiatWalletGrant(65536).catch(console.error);
