import BigNumber from 'bignumber.js';
import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/parsing';
import { db, likeNFTCollection, FieldValue } from '../../firebase';
import { getISCNQueryClient } from '../../cosmos/iscn';
import { getLikerNFTSigningClient } from '../../cosmos/nft';
import { DEFAULT_GAS_PRICE } from '../../cosmos/tx';
import {
  COSMOS_DENOM, LIKER_NFT_TARGET_ADDRESS, LIKER_NFT_PRICE_MULTIPLY, LIKER_NFT_GAS_FEE,
} from '../../../../config/config';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from './mint';

export async function getLowerestUnsoldNFT(iscnId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const res = await likeNFTCollection.doc(iscnPrefix).collection('nft')
    .where('isSold', '==', false)
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

export async function getLatestNFTPrice(iscnId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const [nftData, nftDoc] = await Promise.all([
    getLowerestUnsoldNFT(iscnId),
    likeNFTCollection.doc(iscnPrefix).get(),
  ]);
  const nftDocData = nftDoc.data();
  if (!nftData || !nftDocData) return -1;
  // nft has defined price
  if (nftData.price) return nftData.price;
  // use current price for 0/undefined price nft
  const {
    currentPrice,
  } = nftDocData;
  return currentPrice;
}

export function getGasPrice() {
  return new BigNumber(LIKER_NFT_GAS_FEE).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9).toNumber();
}

export async function checkTxGrantAndAmount(txHash, totalPrice, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getISCNQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  const parsed = parseTxInfoFromIndexedTx(tx);
  let messages = parsed.tx.body.messages
    .filter(m => m.typeUrl === 'cosmos.authz.v1beta1.MsgGrant');
  if (!messages.length) throw new ValidationError('GRANT_MSG_NOT_FOUND');
  messages = messages.filter(m => m.value.grantee === target);
  if (!messages.length) throw new ValidationError('INCORRECT_GRANT_TARGET');
  const message = messages.find(m => m.value.grant.authorization.typeUrl === '/cosmos.bank.v1beta1.SendAuthorization');
  if (!message) throw new ValidationError('SEND_GRANT_NOT_FOUND');
  const {
    granter,
    authorization,
    expiration,
  } = message.value;
  if (Date.now() > expiration * 1000) throw new ValidationError('GRANT_EXPIRED');
  const qs = await client.getQueryClient();
  const c = await qs.authz.grants(granter, target, '/cosmos.bank.v1beta1.MsgSend');
  if (!c) throw new ValidationError('GRANT_NOT_FOUND');
  // TODO: parse limit from query instead of tx
  const { spendLimit } = authorization.value;
  const limit = spendLimit.find(s => s.denom === COSMOS_DENOM);
  if (!limit) throw new ValidationError('SEND_GRANT_DENOM_NOT_FOUND');
  const { amount } = limit;
  const amountInLIKE = new BigNumber(amount).shiftedBy(-9);
  if (amountInLIKE.lt(totalPrice)) throw new ValidationError('GRANT_AMOUNT_NOT_ENOUGH');
  return {
    granter,
    spendLimit: amountInLIKE.toNumber(),
  };
}

export async function processNFTPurchase(likeWallet, iscnId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  // lock iscn nft and get price
  const currentPrice = await db.runTransaction(async (t) => {
    const doc = await t.get(likeNFTCollection.doc(iscnPrefix));
    const docData = doc.data();
    if (!docData) throw new ValidationError('ISCN_NFT_NOT_FOUND');
    const { isProcessing, currentPrice: price } = docData;
    if (isProcessing) {
      throw new ValidationError('ANOTHER_PURCHASE_IN_PROGRESS');
    }
    t.update(likeNFTCollection.doc(iscnPrefix), {
      isProcessing: true,
    });
    return price;
  });
  try {
    const nftData = await getLowerestUnsoldNFT(iscnId);
    const {
      id: nftId,
      price: nftPrice,
      classId,
    } = nftData;
    const gasFee = getGasPrice();
    const actualPrice = nftPrice || currentPrice;
    const totalPrice = actualPrice + gasFee;
    const totalAmount = new BigNumber(totalPrice).shiftedBy(9).toFixed(0);
    const signingClient = await getLikerNFTSigningClient();
    // TODO: merge execute grant and send NFT into one transaction
    const res = await signingClient.executeSendGrant(
      LIKER_NFT_TARGET_ADDRESS,
      likeWallet,
      LIKER_NFT_TARGET_ADDRESS,
      [{ denom: COSMOS_DENOM, amount: totalAmount }],
    );
    const { transactionHash } = res;
    const timestamp = Date.now();
    // update price and unlock
    await db.runTransaction(async (t) => {
      const doc = await t.get(likeNFTCollection.doc(iscnPrefix));
      const docData = doc.data();
      const { isProcessing } = docData;
      if (isProcessing) {
        const fromWallet = LIKER_NFT_TARGET_ADDRESS;
        const toWallet = likeWallet;
        t.update(likeNFTCollection.doc(iscnPrefix), {
          currentPrice: nftPrice * LIKER_NFT_PRICE_MULTIPLY,
          isProcessing: false,
          soldCount: FieldValue.increment(),
        });
        t.update(likeNFTCollection.doc(iscnPrefix).collection('nft').doc(nftId), {
          price: actualPrice,
          isSold: true,
        });
        t.create(likeNFTCollection.doc(iscnPrefix).collection('transactions')
          .doc(transactionHash), {
          txHash: transactionHash,
          price: actualPrice,
          classId,
          nftId,
          timestamp,
          fromWallet,
          toWallet,
        });
      }
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
      const { isProcessing } = docData;
      if (isProcessing) {
        t.update(likeNFTCollection.doc(iscnPrefix), {
          isProcessing: false,
        });
      }
    });
    throw err;
  }
}
