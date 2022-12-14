import BigNumber from 'bignumber.js';
import { parseTxInfoFromIndexedTx, parseAuthzGrant } from '@likecoin/iscn-js/dist/messages/parsing';
import { formatMsgExecSendAuthorization } from '@likecoin/iscn-js/dist/messages/authz';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import { parseAndCalculateStakeholderRewards } from '@likecoin/iscn-js/dist/iscn/parsing';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Transaction } from '@google-cloud/firestore';
import { Request } from 'express';
import { db, likeNFTCollection, FieldValue } from '../../firebase';
import {
  getNFTQueryClient, getNFTISCNData, getLikerNFTSigningClient, getLikerNFTSigningAddressInfo,
} from '../../cosmos/nft';
import {
  DEFAULT_GAS_PRICE, calculateTxGasFee, sendTransactionWithSequence, MAX_MEMO_LENGTH,
} from '../../cosmos/tx';
import {
  NFT_COSMOS_DENOM,
  NFT_CHAIN_ID,
  LIKER_NFT_TARGET_ADDRESS,
  LIKER_NFT_FEE_ADDRESS,
  LIKER_NFT_GAS_FEE,
  LIKER_NFT_STARTING_PRICE,
  LIKER_NFT_PRICE_MULTIPLY,
  LIKER_NFT_PRICE_DECAY,
  LIKER_NFT_DECAY_START_BATCH,
  LIKER_NFT_DECAY_END_BATCH,
} from '../../../../config/config';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';
import publisher from '../../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../constant';

const FEE_RATIO = LIKER_NFT_FEE_ADDRESS ? 0.025 : 0;
const EXPIRATION_BUFFER_TIME = 10000;

export function getNFTBatchInfo(batchNumber) {
  const count = batchNumber + 1;
  const baseMultiplier = Math.min(batchNumber, LIKER_NFT_DECAY_START_BATCH);
  let price = LIKER_NFT_STARTING_PRICE * (LIKER_NFT_PRICE_MULTIPLY ** baseMultiplier);
  const decayMultiplier = Math.min(
    LIKER_NFT_DECAY_END_BATCH - LIKER_NFT_DECAY_START_BATCH,
    Math.max(batchNumber - LIKER_NFT_DECAY_START_BATCH, 0),
  );
  let lastPrice = price;
  for (let i = 1; i <= decayMultiplier; i += 1) {
    price += Math.round(lastPrice * (1 - LIKER_NFT_PRICE_DECAY * i));
    lastPrice = price;
  }
  return {
    price,
    count,
  };
}

export async function getFirstUnsoldNFT(
  iscnPrefixDocName,
  classId,
  { transaction }: { transaction?: Transaction } = {},
) {
  const ref = likeNFTCollection.doc(iscnPrefixDocName)
    .collection('class').doc(classId)
    .collection('nft')
    .where('isSold', '==', false)
    .where('isProcessing', '==', false)
    .where('price', '==', 0)
    .limit(1);
  const res = await (transaction ? transaction.get(ref as any) : ref.get());
  if (!res.docs.length) return null;
  const doc = res.docs[0];
  const payload = {
    id: doc.id,
    ...doc.data(),
  };
  return payload;
}

export async function getLowestSellingNFT(iscnPrefixDocName, classId) {
  const ref = likeNFTCollection.doc(iscnPrefixDocName)
    .collection('class').doc(classId)
    .collection('nft')
    .where('isSold', '==', false)
    .where('isProcessing', '==', false)
    .where('price', '>', 0)
    .orderBy('price', 'asc')
    .limit(1);
  const res = await ref.get();
  if (!res.docs.length) return null;
  const doc = res.docs[0];
  const payload = {
    id: doc.id,
    ...doc.data(),
  };
  return payload;
}

export async function getLatestNFTPriceAndInfo(iscnPrefix, classId) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const [newNftData, sellingNftData, nftDoc] = await Promise.all([
    getFirstUnsoldNFT(iscnPrefixDocName, classId),
    getLowestSellingNFT(iscnPrefixDocName, classId),
    likeNFTCollection.doc(iscnPrefixDocName).get(),
  ]);
  const nftDocData = nftDoc.data();
  let price = -1;
  let isResell = false;
  let nftId;
  let nextNewNFTId;
  const {
    currentPrice,
    currentBatch,
    lastSoldPrice,
  } = nftDocData;
  if (newNftData) {
    price = currentPrice;
    // This NFT ID represents a possible NFT of that NFT Class for purchasing only,
    // another fresh one might be used on purchase instead
    nextNewNFTId = newNftData.id;
  }
  if (sellingNftData) {
    // nft has defined price
    if (sellingNftData.price && (price === -1 || sellingNftData.price <= price)) {
      ({ price } = sellingNftData);
      nftId = sellingNftData.id;
      isResell = true;
    }
  }
  const { price: nextPriceLevel } = getNFTBatchInfo(currentBatch + 1);
  return {
    ...nftDocData,
    nftId,
    nextNewNFTId,
    lastSoldPrice: lastSoldPrice || currentPrice,
    price,
    nextPriceLevel,
    isResell,
  };
}

export function getGasPrice() {
  return new BigNumber(LIKER_NFT_GAS_FEE).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9).toNumber();
}

export async function checkWalletGrantAmount(granter, grantee, targetAmount) {
  const client = await getNFTQueryClient();
  const qs = await client.getQueryClient();
  let grant;
  try {
    const c = await qs.authz.grants(granter, grantee, '/cosmos.bank.v1beta1.MsgSend');
    if (!c) throw new ValidationError('GRANT_NOT_FOUND');
    ([grant] = c.grants.map(parseAuthzGrant));
  } catch (err) {
    if ((err as Error).message.includes('no authorization found')) {
      throw new ValidationError('GRANT_NOT_FOUND');
    }
    throw err;
  }
  if (!grant) throw new ValidationError('GRANT_NOT_FOUND');
  const { expiration, authorization } = grant;
  const { spendLimit } = authorization.value;
  const limit = spendLimit.find((s) => s.denom === NFT_COSMOS_DENOM);
  if (!limit) throw new ValidationError('SEND_GRANT_DENOM_NOT_FOUND');
  const { amount } = limit;
  const amountInLIKE = new BigNumber(amount).shiftedBy(-9);
  if (amountInLIKE.lt(targetAmount)) throw new ValidationError('GRANT_AMOUNT_NOT_ENOUGH');
  if (Date.now() + EXPIRATION_BUFFER_TIME > expiration * 1000) throw new ValidationError('GRANT_EXPIRED');
  return amountInLIKE.toFixed();
}

export async function checkTxGrantAndAmount(txHash, totalPrice, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getNFTQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  if (!tx) throw new Error('TX_NOT_FOUND');
  const parsed = parseTxInfoFromIndexedTx(tx);
  let messages = parsed.tx.body.messages
    .filter((m) => m.typeUrl === '/cosmos.authz.v1beta1.MsgGrant');
  if (!messages.length) throw new ValidationError('GRANT_MSG_NOT_FOUND');
  messages = messages.filter((m) => m.value.grantee === target);
  if (!messages.length) throw new ValidationError('INCORRECT_GRANT_TARGET');
  const message = messages.find((m) => m.value.grant.authorization.typeUrl === '/cosmos.bank.v1beta1.SendAuthorization');
  if (!message) throw new ValidationError('SEND_GRANT_NOT_FOUND');
  const { granter } = message.value;
  const amountInLIKEString = await checkWalletGrantAmount(granter, target, totalPrice);
  const balance = await q.getBalance(granter, NFT_COSMOS_DENOM);
  const balanceAmountInLIKE = new BigNumber(balance.amount || 0).shiftedBy(-9);
  if (balanceAmountInLIKE.lt(totalPrice)) throw new ValidationError('GRANTER_AMOUNT_NOT_ENOUGH');
  return {
    granter,
    spendLimit: new BigNumber(amountInLIKEString).toNumber(),
  };
}

export async function handleNFTPurchaseTransaction({
  iscnPrefix,
  iscnData,
  classId,
  nftId,
  nftPrice,
  sellerWallet,
  buyerWallet,
  granterWallet,
  feeWallet,
  isResell = false,
  memo,
}, req?: Request) {
  const STAKEHOLDERS_RATIO = isResell ? 0.1 : 1 - FEE_RATIO;
  const SELLER_RATIO = 1 - FEE_RATIO - STAKEHOLDERS_RATIO;
  const gasFee = getGasPrice();
  const { owner, data } = iscnData;
  const totalPrice = nftPrice + gasFee;
  const totalAmount = new BigNumber(totalPrice).shiftedBy(9).toFixed(0);
  const feeAmount = new BigNumber(nftPrice)
    .multipliedBy(FEE_RATIO).shiftedBy(9).toFixed(0);
  const sellerAmount = new BigNumber(nftPrice)
    .multipliedBy(SELLER_RATIO).shiftedBy(9).toFixed(0);
  const stakeholdersAmount = new BigNumber(nftPrice)
    .multipliedBy(STAKEHOLDERS_RATIO).shiftedBy(9).toFixed(0);
  const transferMessages: any = [];
  if (sellerAmount && new BigNumber(sellerAmount).gt(0)) {
    transferMessages.push({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: LIKER_NFT_TARGET_ADDRESS,
        toAddress: sellerWallet,
        amount: [{ denom: NFT_COSMOS_DENOM, amount: sellerAmount }],
      },
    });
  }
  if (feeAmount && new BigNumber(feeAmount).gt(0)) {
    transferMessages.push({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: LIKER_NFT_TARGET_ADDRESS,
        toAddress: feeWallet,
        amount: [{ denom: NFT_COSMOS_DENOM, amount: feeAmount }],
      },
    });
  }

  const stakeholderMap = await parseAndCalculateStakeholderRewards(
    data,
    owner,
    { totalAmount: stakeholdersAmount, precision: 0 },
  );
  stakeholderMap.forEach(({ amount }, wallet) => {
    transferMessages.push(
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: LIKER_NFT_TARGET_ADDRESS,
          toAddress: wallet,
          // TODO: fix iscn-js to use string for amount input and output
          amount: [{
            denom: NFT_COSMOS_DENOM,
            amount,
          }],
        },
      },
    );
  });
  const signingClient = await getLikerNFTSigningClient();
  const txMessages = [
    formatMsgExecSendAuthorization(
      LIKER_NFT_TARGET_ADDRESS,
      granterWallet,
      LIKER_NFT_TARGET_ADDRESS,
      [{ denom: NFT_COSMOS_DENOM, amount: totalAmount }],
    ),
    formatMsgSend(
      LIKER_NFT_TARGET_ADDRESS,
      buyerWallet,
      classId,
      nftId,
    ),
    ...transferMessages,
  ];
  let res;
  const client = signingClient.getSigningStargateClient();
  if (!client) throw new Error('CANNOT_GET_SIGNING_CLIENT');
  const fee = calculateTxGasFee(txMessages.length, NFT_COSMOS_DENOM);
  const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
  const txSigningFunction = ({ sequence }) => client.sign(
    address,
    txMessages,
    fee,
    memo,
    {
      accountNumber,
      sequence,
      chainId: NFT_CHAIN_ID,
    },
  );
  try {
    res = await sendTransactionWithSequence(
      address,
      txSigningFunction,
      client,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    throw new ValidationError(err);
  }
  const { transactionHash, code } = res;
  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.error(`Tx ${transactionHash} failed with code ${code}`);
    throw new ValidationError('TX_NOT_SUCCESS');
  }
  const timestamp = Date.now();
  // update price and unlock

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'LikerNFTPurchaseTransaction',
    txHash: transactionHash,
    iscnId: iscnPrefix,
    classId,
    nftId,
    buyerWallet,
  });

  const sellerLIKE = new BigNumber(sellerAmount).shiftedBy(-9).toFixed();
  const feeLIKE = new BigNumber(feeAmount).shiftedBy(-9).toFixed();
  const stakeholderWallets = [...stakeholderMap.keys()];
  const stakeholderLIKEs = [...stakeholderMap.values()]
    .map((a) => new BigNumber(a.amount).shiftedBy(-9).toFixed());
  return {
    transactionHash,
    timestamp,
    sellerLIKE,
    feeLIKE,
    stakeholderWallets,
    stakeholderLIKEs,
    gasFee,
  };
}

export async function processNFTPurchase({
  buyerWallet,
  iscnPrefix,
  classId,
  granterWallet = buyerWallet,
  grantedAmount,
  nftId: targetNftId = undefined,
}, req) {
  const iscnData = await getNFTISCNData(iscnPrefix); // always fetch from prefix
  if (!iscnData) throw new ValidationError('ISCN_DATA_NOT_FOUND');
  const { owner } = iscnData;
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const iscnRef = likeNFTCollection.doc(iscnPrefixDocName);
  const classRef = iscnRef.collection('class').doc(classId);
  const classDoc = await classRef.get();
  const {
    metadata: {
      message = '',
    } = {},
  } = classDoc.data();
  let memo = message.replaceAll('{collector}', buyerWallet) || '';
  memo = Buffer.byteLength(memo, 'utf8') > MAX_MEMO_LENGTH ? Buffer.from(memo).slice(0, MAX_MEMO_LENGTH).toString() : memo;
  if (!iscnData) throw new ValidationError('CLASS_DATA_NOT_FOUND');

  // lock iscn nft
  const {
    isResell,
    nftId,
    nftPrice,
    sellerWallet,
    currentBatch,
  } = await db.runTransaction(async (t) => {
    /* eslint-disable no-underscore-dangle */
    let _nftPrice = 0;
    let _currentBatch = -1;
    let _sellerWallet;
    let nftDocData;
    if (!targetNftId) { // get fresh ones if not targeted nft id
      nftDocData = await getFirstUnsoldNFT(iscnPrefixDocName, classId, { transaction: t });
    } else {
      const nftDoc = await t.get(classRef.collection('nft').doc(targetNftId));
      nftDocData = { id: nftDoc.id, ...nftDoc.data() };
    }
    const {
      id: _nftId, isProcessing, price = 0, sellerWallet: nftSellerWallet,
    } = nftDocData;
    if (isProcessing) throw new ValidationError('ANOTHER_PURCHASE_IN_PROGRESS');
    const _isResell = !!price;
    if (_isResell) {
      _nftPrice = price;
      _sellerWallet = nftSellerWallet || owner;
    } else {
      const doc = await t.get(iscnRef);
      const docData = doc.data();
      if (!docData) throw new ValidationError('ISCN_NFT_NOT_FOUND');
      const {
        processingCount = 0,
        currentPrice,
        currentBatch: batch,
        batchRemainingCount,
      } = docData;
      _sellerWallet = owner;
      _nftPrice = currentPrice;
      _currentBatch = batch;
      if (processingCount >= batchRemainingCount) {
        throw new ValidationError('ANOTHER_PURCHASE_IN_PROGRESS');
      }
      t.update(iscnRef, { processingCount: FieldValue.increment(1) });
    }
    if (_nftPrice > grantedAmount) {
      throw new ValidationError('GRANT_NOT_MATCH_UPDATED_PRICE');
    }
    const txNftRef = classRef.collection('nft').doc(_nftId);
    t.update(txNftRef, { isProcessing: true });
    return {
      isResell: _isResell,
      nftId: _nftId,
      nftPrice: _nftPrice,
      sellerWallet: _sellerWallet,
      currentBatch: _currentBatch,
    };
    /* eslint-enable no-underscore-dangle */
  });
  const nftRef = classRef.collection('nft').doc(nftId);
  try {
    const feeWallet = LIKER_NFT_FEE_ADDRESS;
    const {
      transactionHash,
      timestamp,
      sellerLIKE,
      feeLIKE,
      stakeholderWallets,
      stakeholderLIKEs,
      gasFee,
    } = await handleNFTPurchaseTransaction({
      iscnPrefix,
      iscnData,
      classId,
      nftId,
      nftPrice,
      sellerWallet,
      buyerWallet,
      granterWallet,
      feeWallet,
      memo,
    });
    await db.runTransaction(async (t) => {
      const doc = await t.get(iscnRef);
      const docData = doc.data();
      const {
        currentPrice: dbCurrentPrice,
        currentBatch: dbCurrentBatch,
        batchRemainingCount: dbBatchRemainingCount,
        processingCount: dbProcessingCount,
      } = docData;
      const fromWallet = LIKER_NFT_TARGET_ADDRESS;
      const toWallet = buyerWallet;
      let updatedBatch = dbCurrentBatch;
      let batchRemainingCount = dbBatchRemainingCount;
      let newPrice = dbCurrentPrice;
      let processingCount = dbProcessingCount;
      if (dbCurrentBatch === currentBatch) {
        if (!isResell) {
          processingCount = FieldValue.increment(-1);
          batchRemainingCount -= 1;
          const isNewBatch = batchRemainingCount <= 0;
          if (isNewBatch) {
            processingCount = 0;
            updatedBatch = dbCurrentBatch + 1;
            ({ price: newPrice, count: batchRemainingCount } = getNFTBatchInfo(updatedBatch));
          }
        }
      }
      t.update(iscnRef, {
        currentPrice: newPrice,
        currentBatch: updatedBatch,
        batchRemainingCount,
        processingCount,
        soldCount: FieldValue.increment(1),
        nftRemainingCount: FieldValue.increment(-1),
        lastSoldPrice: nftPrice,
        lastSoldTimestamp: timestamp,
      });
      t.update(classRef, {
        lastSoldPrice: nftPrice,
        lastSoldNftId: nftId,
        lastSoldTimestamp: timestamp,
        soldCount: FieldValue.increment(1),
      });
      t.update(nftRef, {
        price: nftPrice,
        lastSoldPrice: nftPrice,
        soldCount: FieldValue.increment(1),
        isSold: true,
        isProcessing: false,
        ownerWallet: toWallet,
        lastSoldTimestamp: timestamp,
        sellerWallet: null,
      });
      t.create(iscnRef.collection('transaction')
        .doc(transactionHash), {
        event: 'purchase',
        txHash: transactionHash,
        price: nftPrice,
        classId,
        nftId,
        timestamp,
        fromWallet,
        toWallet,
        granterWallet,
        sellerWallet,
        sellerLIKE,
        stakeholderWallets,
        stakeholderLIKEs,
      });
    });
    return {
      transactionHash,
      classId,
      nftId,
      nftPrice,
      gasFee,
      sellerWallet,
      sellerLIKE,
      stakeholderWallets,
      stakeholderLIKEs,
      feeWallet,
      feeLIKE,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // reset lock
    await db.runTransaction(async (t) => {
      if (!isResell) {
        const doc = await t.get(iscnRef);
        const docData = doc.data();
        const { currentBatch: docCurrentBatch } = docData;
        if (docCurrentBatch === currentBatch) {
          t.update(iscnRef, { processingCount: FieldValue.increment(-1) });
        }
      }
      t.update(nftRef, { isProcessing: false });
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTPurchaseError',
      iscnId: iscnPrefix,
      classId,
      nftId,
      buyerWallet,
    });
    throw err;
  }
}
