import BigNumber from 'bignumber.js';
import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/messages/parsing';
import { formatSendAuthorizationMsgExec } from '@likecoin/iscn-js/dist/messages/authz';
import { formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
import { db, likeNFTCollection, FieldValue } from '../../firebase';
import { getNFTQueryClient, getNFTISCNOwner, getLikerNFTSigningClient } from '../../cosmos/nft';
import { DEFAULT_GAS_PRICE } from '../../cosmos/tx';
import {
  NFT_COSMOS_DENOM, LIKER_NFT_TARGET_ADDRESS, LIKER_NFT_PRICE_MULTIPLY, LIKER_NFT_GAS_FEE,
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

export async function getLatestNFTPriceAndInfo(iscnId) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const [nftData, nftDoc] = await Promise.all([
    getLowerestUnsoldNFT(iscnId),
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
      price: nftItemPrice,
      classId,
      sellerWallet: nftItemSellerWallet,
    } = nftData;
    const gasFee = getGasPrice();

    const isFirstSale = !nftItemPrice; // first sale if price = 0;
    let sellerWallet;
    let nftPrice;
    if (isFirstSale) {
      nftPrice = currentPrice;
      // TODO: split according to stakeholders
      sellerWallet = await getNFTISCNOwner(iscnId);
    } else {
      nftPrice = nftItemPrice;
      // TODO: split according to stakeholders
      sellerWallet = nftItemSellerWallet || await getNFTISCNOwner(iscnId);
    }

    const totalPrice = nftPrice + gasFee;
    // TODO: split with stakeholder
    const sellerPrice = nftPrice;
    const sellerAmount = new BigNumber(nftPrice).shiftedBy(9).toFixed(0);
    const totalAmount = new BigNumber(totalPrice).shiftedBy(9).toFixed(0);
    const signingClient = await getLikerNFTSigningClient();
    const txMessages = [
      formatSendAuthorizationMsgExec(
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
      ), {
        // TODO: use stakeholder and multisend
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: LIKER_NFT_TARGET_ADDRESS,
          toAddress: sellerWallet,
          amount: [{ denom: NFT_COSMOS_DENOM, amount: sellerAmount }],
        },
      },
    ];
    let res;
    try {
      res = await signingClient.sendMessages(
        LIKER_NFT_TARGET_ADDRESS,
        txMessages,
      );
    } catch (err) {
      console.error(err);
      throw new ValidationError(err);
    }
    const { transactionHash } = res;
    const timestamp = Date.now();
    // update price and unlock
    await db.runTransaction(async (t) => {
      const doc = await t.get(likeNFTCollection.doc(iscnPrefix));
      const docData = doc.data();
      const { isProcessing, currentPrice: dbCurrentPrice } = docData;
      if (isProcessing) {
        const fromWallet = LIKER_NFT_TARGET_ADDRESS;
        const toWallet = likeWallet;
        t.update(likeNFTCollection.doc(iscnPrefix), {
          currentPrice: nftItemPrice ? dbCurrentPrice : dbCurrentPrice * LIKER_NFT_PRICE_MULTIPLY,
          isProcessing: false,
          soldCount: FieldValue.increment(1),
        });
        t.update(likeNFTCollection.doc(iscnPrefix).collection('nft').doc(nftId), {
          price: nftPrice,
          isSold: true,
        });
        t.create(likeNFTCollection.doc(iscnPrefix).collection('transaction')
          .doc(transactionHash), {
          txHash: transactionHash,
          price: nftPrice,
          classId,
          nftId,
          timestamp,
          fromWallet,
          toWallet,
          sellerWallet,
          sellerLIKE: sellerPrice,
          // stakeholderWallets,
          // stakeholderLIKEs,
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
