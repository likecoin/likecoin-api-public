import BigNumber from 'bignumber.js';
import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/messages/parsing';
import { formatMsgExecSendAuthorization } from '@likecoin/iscn-js/dist/messages/authz';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import { db, likeNFTCollection, FieldValue } from '../../firebase';
import {
  getNFTQueryClient, getNFTISCNData, getLikerNFTSigningClient, getLikerNFTSigningAddressInfo,
} from '../../cosmos/nft';
import { getISCNStakeholderRewards } from '../../cosmos/iscn';
import { DEFAULT_GAS_PRICE, calculateTxGasFee, sendTransactionWithSequence } from '../../cosmos/tx';
import {
  NFT_COSMOS_DENOM,
  NFT_CHAIN_ID,
  LIKER_NFT_TARGET_ADDRESS,
  LIKER_NFT_GAS_FEE,
  LIKER_NFT_STARTING_PRICE,
  LIKER_NFT_PRICE_MULTIPLY,
  LIKER_NFT_PRICE_DECAY,
  LIKER_NFT_DECAY_START_BATCH,
  LIKER_NFT_DECAY_END_BATCH,
} from '../../../../config/config';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';

const SELLER_RATIO = 0.8;
const STAKEHOLDERS_RATIO = 0.2;

export async function getLowerestUnsoldNFT(iscnId, classId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const res = await likeNFTCollection.doc(iscnPrefix)
    .collection('class').doc(classId)
    .collection('nft')
    .where('isSold', '==', false)
    .where('isProcessing', '==', false)
    .where('price', '>=', 0)
    .orderBy('price')
    .limit(1)
    .get();
  if (!res.docs.length) return null;
  const doc = res.docs[0];
  const payload = {
    id: doc.id,
    ...doc.data(),
  };
  return payload;
}

export async function getLatestNFTPriceAndInfo(iscnId, classId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const [nftData, nftDoc] = await Promise.all([
    getLowerestUnsoldNFT(iscnId, classId),
    likeNFTCollection.doc(iscnPrefix).get(),
  ]);
  const nftDocData = nftDoc.data();
  let price = -1;
  const {
    currentPrice,
  } = nftDocData;
  // nft has defined price
  if (nftData.price) {
    ({ price } = nftData);
  } else {
    // use current price for 0/undefined price nft
    price = currentPrice;
  }
  return {
    ...nftDocData,
    price,
  };
}

export function getGasPrice() {
  return new BigNumber(LIKER_NFT_GAS_FEE).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9).toNumber();
}

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

export async function checkTxGrantAndAmount(txHash, totalPrice, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getNFTQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  const parsed = parseTxInfoFromIndexedTx(tx);
  let messages = parsed.tx.body.messages
    .filter(m => m.typeUrl === '/cosmos.authz.v1beta1.MsgGrant');
  if (!messages.length) throw new ValidationError('GRANT_MSG_NOT_FOUND');
  messages = messages.filter(m => m.value.grantee === target);
  if (!messages.length) throw new ValidationError('INCORRECT_GRANT_TARGET');
  const message = messages.find(m => m.value.grant.authorization.typeUrl === '/cosmos.bank.v1beta1.SendAuthorization');
  if (!message) throw new ValidationError('SEND_GRANT_NOT_FOUND');
  const { granter, grant } = message.value;
  const { authorization, expiration } = grant;
  if (Date.now() > expiration * 1000) throw new ValidationError('GRANT_EXPIRED');
  const qs = await client.getQueryClient();
  try {
    const c = await qs.authz.grants(granter, target, '/cosmos.bank.v1beta1.MsgSend');
    if (!c) throw new ValidationError('GRANT_NOT_FOUND');
  } catch (err) {
    if (err.message.includes('no authorization found')) {
      throw new ValidationError('GRANT_NOT_FOUND');
    }
    throw err;
  }
  // TODO: parse limit from query instead of tx
  const { spendLimit } = authorization.value;
  const limit = spendLimit.find(s => s.denom === NFT_COSMOS_DENOM);
  if (!limit) throw new ValidationError('SEND_GRANT_DENOM_NOT_FOUND');
  const { amount } = limit;
  const amountInLIKE = new BigNumber(amount).shiftedBy(-9);
  if (amountInLIKE.lt(totalPrice)) throw new ValidationError('GRANT_AMOUNT_NOT_ENOUGH');
  return {
    granter,
    spendLimit: amountInLIKE.toNumber(),
  };
}

export async function processNFTPurchase(likeWallet, iscnId, classId) {
  const iscnData = await getNFTISCNData(iscnId);
  if (!iscnData) throw new Error('ISCN_DATA_NOT_FOUND');
  const iscnPrefix = getISCNPrefixDocName(iscnId);

  // get price
  const nftData = await getLowerestUnsoldNFT(iscnId, classId);
  const {
    id: nftId,
    price: nftItemPrice,
    sellerWallet: nftItemSellerWallet,
  } = nftData;

  const isFirstSale = !nftItemPrice; // first sale if price = 0;

  const iscnRef = likeNFTCollection.doc(iscnPrefix);
  const classRef = iscnRef.collection('class').doc(classId);
  const nftRef = classRef.collection('nft').doc(nftId);

  // lock iscn nft
  const { price: currentPrice, batch: currentBatch } = await db.runTransaction(async (t) => {
    const doc = await t.get(iscnRef);
    const nftDoc = await t.get(nftRef);
    const { isProcessing } = nftDoc.data();
    if (isProcessing) throw new ValidationError('ANOTHER_PURCHASE_IN_PROGRESS');
    const docData = doc.data();
    if (!docData) throw new ValidationError('ISCN_NFT_NOT_FOUND');
    const {
      processingCount = 0,
      currentPrice: price,
      currentBatch: batch,
      batchRemainingCount,
    } = docData;
    if (processingCount >= batchRemainingCount) {
      throw new ValidationError('ANOTHER_PURCHASE_IN_PROGRESS');
    }
    t.update(iscnRef, { processingCount: FieldValue.increment(1) });
    t.update(nftRef, { isProcessing: true });
    return { price, batch };
  });
  try {
    const gasFee = getGasPrice();
    let sellerWallet;
    const { owner, data } = iscnData;
    let nftPrice;
    if (isFirstSale) {
      nftPrice = currentPrice;
      sellerWallet = owner;
    } else {
      nftPrice = nftItemPrice;
      sellerWallet = nftItemSellerWallet || owner;
    }

    const totalPrice = nftPrice + gasFee;
    const totalAmount = new BigNumber(totalPrice).shiftedBy(9).toFixed(0);
    const sellerAmount = new BigNumber(nftPrice)
      .multipliedBy(SELLER_RATIO).shiftedBy(9).toFixed(0);
    const stakeholdersAmount = new BigNumber(nftPrice)
      .multipliedBy(STAKEHOLDERS_RATIO).shiftedBy(9).toFixed(0);
    const transferMessages = [
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: LIKER_NFT_TARGET_ADDRESS,
          toAddress: sellerWallet,
          amount: [{ denom: NFT_COSMOS_DENOM, amount: sellerAmount }],
        },
      },
    ];

    const stakeholderMap = await getISCNStakeholderRewards(data, stakeholdersAmount, owner);
    stakeholderMap.forEach((amount, wallet) => {
      transferMessages.push(
        {
          typeUrl: '/cosmos.bank.v1beta1.MsgSend',
          value: {
            fromAddress: LIKER_NFT_TARGET_ADDRESS,
            toAddress: wallet,
            amount: [{ denom: NFT_COSMOS_DENOM, amount }],
          },
        },
      );
    });
    const signingClient = await getLikerNFTSigningClient();
    const txMessages = [
      formatMsgExecSendAuthorization(
        LIKER_NFT_TARGET_ADDRESS,
        likeWallet,
        LIKER_NFT_TARGET_ADDRESS,
        [{ denom: NFT_COSMOS_DENOM, amount: totalAmount }],
      ),
      formatMsgSend(
        LIKER_NFT_TARGET_ADDRESS,
        likeWallet,
        classId,
        nftId,
      ),
      ...transferMessages,
    ];
    let res;
    const client = signingClient.getSigningStargateClient();
    const fee = calculateTxGasFee(txMessages.length, NFT_COSMOS_DENOM);
    const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
    const txSigningFunction = ({ sequence }) => client.sign(
      address,
      txMessages,
      fee,
      'like.co NFT API',
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
      console.error(err);
      throw new ValidationError(err);
    }
    const { transactionHash } = res;
    const timestamp = Date.now();
    // update price and unlock
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
      const toWallet = likeWallet;
      let updatedBatch = dbCurrentBatch;
      let batchRemainingCount = dbBatchRemainingCount;
      let newPrice = dbCurrentPrice;
      let processingCount = dbProcessingCount;
      if (isFirstSale) {
        processingCount = FieldValue.increment(-1);
        batchRemainingCount -= 1;
        const isNewBatch = batchRemainingCount <= 0;
        if (isNewBatch) {
          processingCount = 0;
          updatedBatch = dbCurrentBatch + 1;
          ({ price: newPrice, count: batchRemainingCount } = getNFTBatchInfo(updatedBatch));
        }
      }
      t.update(iscnRef, {
        currentPrice: newPrice,
        currentBatch: updatedBatch,
        batchRemainingCount,
        processingCount,
        soldCount: FieldValue.increment(1),
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
        txHash: transactionHash,
        price: nftPrice,
        classId,
        nftId,
        timestamp,
        fromWallet,
        toWallet,
        sellerWallet,
        sellerLIKE: new BigNumber(sellerAmount).shiftedBy(-9).toFixed(),
        stakeholderWallets: [...stakeholderMap.keys()],
        stakeholderLIKEs: [...stakeholderMap.values()]
          .map(a => new BigNumber(a).shiftedBy(-9).toFixed()),
      });
    });
    return {
      transactionHash,
      classId,
      nftId,
      nftPrice,
      gasFee,
    };
  } catch (err) {
    console.error(err);
    // reset lock
    await db.runTransaction(async (t) => {
      const doc = await t.get(likeNFTCollection.doc(iscnPrefix));
      const docData = doc.data();
      const { currentBatch: docCurrentBatch } = docData;
      if (docCurrentBatch === currentBatch) {
        t.update(iscnRef, { processingCount: FieldValue.increment(-1) });
      }
    });
    throw err;
  }
}
