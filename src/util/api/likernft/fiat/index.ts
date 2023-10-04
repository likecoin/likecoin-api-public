import BigNumber from 'bignumber.js';
import { DeliverTxResponse } from '@cosmjs/stargate';

import { db, likeNFTFiatCollection } from '../../../firebase';
import { PUBSUB_TOPIC_MISC } from '../../../../constant';
import {
  getLIKEPrice,
  checkWalletGrantAmount,
  getLatestNFTPriceAndInfo,
  rewardModifierForCheckoutWithLIKE,
  processNFTPurchase,
  rewardModifierForCheckoutWithUSD,
} from '../purchase';
import { getLikerNFTFiatSigningClientAndWallet } from '../../../cosmos/nft';
import publisher from '../../../gcloudPub';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../../config/config';
import { ValidationError } from '../../../ValidationError';

let fiatGranterWallet;

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

export async function calculatePayment(purchaseInfoList, { buffer = 0.1 } = {}) {
  const rate = await getLIKEPrice();
  const priceReducer = (acc: BigNumber, price: BigNumber) => (
    price.isLessThan(0) ? acc : acc.plus(price)
  );

  const calculateTotalLIKEPrice = (
    modifier: (price: BigNumber) => BigNumber,
  ) => Number(
    purchaseInfoList
      .map(({ price }) => new BigNumber(price))
      .map(modifier)
      .reduce(priceReducer, new BigNumber(0))
      .dividedBy(rate)
      .multipliedBy(1 + buffer)
      .toFixed(0, BigNumber.ROUND_UP),
  );
  const rewardModifierWithoutDiscount = (price: BigNumber) => price;

  const totalLIKEPrice = calculateTotalLIKEPrice(rewardModifierForCheckoutWithLIKE);
  const totalLIKEPriceNoDiscount = calculateTotalLIKEPrice(rewardModifierWithoutDiscount);
  const totalFiatBigNum = purchaseInfoList
    .reduce((acc, { price }) => acc.plus(price), new BigNumber(0));
  const totalFiatPriceString = totalFiatBigNum.toFixed(2);
  return {
    totalLIKEPriceNoDiscount,
    totalLIKEPrice,
    totalFiatPriceString,
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
    const rewardModifier = (
      (p: BigNumber) => rewardModifierForCheckoutWithUSD(p, purchaseInfoList.length));
    const { transactionHash, purchaseInfoList: _purchaseInfoList } = await processNFTPurchase({
      buyerWallet: likeWallet,
      iscnPrefixes,
      classIds,
      granterWallet: fiatGranterWallet,
      grantedAmount: LIKEPrice,
      grantTxHash: paymentId,
      granterMemo: memo,
      rewardModifier,
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
