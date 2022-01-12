// eslint-disable-next-line import/no-extraneous-dependencies
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { StargateClient } from '@cosmjs/stargate';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import createHash from 'create-hash';
import { getAccountInfo } from './index';
import { db, txCollection as txLogRef } from '../firebase';
import { sleep } from '../misc';
import publisher from '../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const {
  COSMOS_DENOM,
  COSMOS_RPC_ENDPOINT,
  COSMOS_GAS_PRICE,
} = require('../../../config/config');

export const DEFAULT_GAS_PRICE = COSMOS_GAS_PRICE || 1000;
export const DEFAULT_TRANSFER_GAS = 80000;

let stargateClient = null;

async function getClient() {
  if (!stargateClient) stargateClient = await StargateClient.connect(COSMOS_RPC_ENDPOINT);
  return stargateClient;
}

export async function queryLIKETransactionInfo(txHash, targetAddress) {
  const client = await getClient();
  const tx = await client.getTx(txHash);
  if (!tx) return null;
  const {
    code,
    tx: rawTx,
  } = tx;
  if (code) return null;
  const {
    body,
  } = decodeTxRaw(rawTx);
  const { messages: rawMessages, memo } = body;
  const messages = rawMessages.map(((m) => {
    const { typeUrl, value } = m;
    if (typeUrl === '/cosmos.bank.v1beta1.MsgSend') {
      const payloadValue = MsgSend.decode(value);
      return {
        typeUrl,
        value: payloadValue,
      };
    }
    return null;
  })).filter(m => !!m);
  const message = messages.find(m => m && m.value.toAddress === targetAddress);
  if (!message) return null;
  const {
    fromAddress,
    toAddress,
    amount: amounts,
  } = message.value;
  const amount = amounts.find(a => a.denom === COSMOS_DENOM);
  return {
    from: fromAddress,
    to: toAddress,
    amount,
    messages,
    memo,
  };
}

async function computeTransactionHash(signedTx) {
  const tx = Uint8Array.from(TxRaw.encode(signedTx).finish());
  const sha256 = createHash('sha256');
  const txHash = sha256
    .update(Buffer.from(tx.buffer))
    .digest('hex');
  return txHash.toUpperCase();
}

async function internalSendTransaction(signedTx) {
  const client = await getClient();
  const txBytes = TxRaw.encode(signedTx).finish();
  try {
    const res = await client.broadcastTx(txBytes);
    return res;
  } catch (err) {
    const { message } = err;
    if (message && message.includes('tx already exists')) {
      const transactionHash = await computeTransactionHash(signedTx);
      return { transactionHash };
    }
    throw new Error(err);
  }
}

export async function sendTransactionWithSequence(senderAddress, signingFunction) {
  let res;
  let signedTx;
  const { sequence: seq1 } = await getAccountInfo(senderAddress);
  const counterRef = txLogRef.doc(`!counter_${senderAddress}`);
  let pendingCount = await db.runTransaction(async (t) => {
    const d = await t.get(counterRef);
    if (!d.data()) {
      const count = seq1.toNumber();
      await t.create(counterRef, { value: count + 1 });
      return count;
    }
    const v = d.data().value + 1;
    await t.update(counterRef, { value: v });
    return v - 1;
  });
  signedTx = await signingFunction({ sequence: pendingCount });
  try {
    res = await internalSendTransaction(signedTx);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const { message } = err;
    if (message && message.includes('code 32')) {
      // eslint-disable-next-line no-console
      console.log(`Nonce ${pendingCount} failed, trying refetch sequence`);
      const { sequence: seq2 } = await getAccountInfo(senderAddress);
      pendingCount = seq2.toNumber();
      signedTx = await signingFunction({ sequence: pendingCount });
    } else {
      await sleep(2000);
    }
  }

  try {
    if (!res) {
      res = await internalSendTransaction(signedTx);
    }
    await db.runTransaction(t => t.get(counterRef).then((d) => {
      if (pendingCount + 1 > d.data().value) {
        return t.update(counterRef, {
          value: pendingCount + 1,
        });
      }
      return Promise.resolve();
    }));
  } catch (err) {
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventCosmosError',
      fromWallet: senderAddress,
      txHash: (res || {}).transactionHash,
      txSequence: pendingCount,
      error: err.toString(),
    });
    // eslint-disable-next-line no-console
    console.error(err);
    throw err;
  }
  return {
    ...res,
    tx: signedTx,
    transactionHash: res.transactionHash,
    senderAddress,
    sequence: pendingCount,
  };
}

export function generateSendTxData(senderAddress, toAddress, amount) {
  const gas = DEFAULT_TRANSFER_GAS;
  const feeAmount = (gas * DEFAULT_GAS_PRICE).toFixed(0);
  const fee = {
    amount: [{ denom: COSMOS_DENOM, amount: feeAmount }],
    gas: gas.toString(),
  };
  const messages = [{
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: {
      fromAddress: senderAddress,
      toAddress,
      amount: [{ denom: COSMOS_DENOM, amount }],
    },
  }];
  return {
    messages,
    fee,
  };
}

export default queryLIKETransactionInfo;
