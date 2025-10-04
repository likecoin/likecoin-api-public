// eslint-disable-next-line import/no-extraneous-dependencies
import { decodeTxRaw, EncodeObject } from '@cosmjs/proto-signing';
import {
  SigningStargateClient, StargateClient, StdFee, assertIsDeliverTxSuccess,
} from '@cosmjs/stargate';
import { ISCNSigningClient } from '@likecoin/iscn-js';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import createHash from 'create-hash';
import BigNumber from 'bignumber.js';
import { COSMOS_CHAIN_ID, getAccountInfo } from './index';
import { admin, db, txCollection as txLogRef } from '../firebase';
import { sleep } from '../misc';
import publisher from '../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const {
  COSMOS_DENOM,
  COSMOS_RPC_ENDPOINT,
  COSMOS_SIGNING_RPC_ENDPOINT,
  COSMOS_GAS_PRICE,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('../../../config/config');

export const DEFAULT_GAS_PRICE = COSMOS_GAS_PRICE || 10000;
export const DEFAULT_TRANSFER_GAS = 100000;
export const DEFAULT_CHANGE_ISCN_OWNERSHIP_GAS = 80000;
export const MAX_MEMO_LENGTH = 256;

let stargateClient: StargateClient | null = null;
let broadcastClient: StargateClient | null = null;

async function getBroadcastClient(): Promise<StargateClient> {
  if (!broadcastClient) broadcastClient = await StargateClient.connect(COSMOS_SIGNING_RPC_ENDPOINT);
  return broadcastClient;
}

export async function getClient(): Promise<StargateClient> {
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
  })).filter((m) => !!m);
  const message = messages.find((m) => m && m.value.toAddress === targetAddress);
  if (!message) return null;
  const {
    fromAddress,
    toAddress,
    amount: amounts,
  } = message.value;
  const amount = amounts.find((a) => a.denom === COSMOS_DENOM);
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

async function internalSendTransaction(signedTx, c: StargateClient | null = null) {
  const client = c || await getBroadcastClient();
  const txBytes = TxRaw.encode(signedTx).finish();
  try {
    const res = await client.broadcastTx(txBytes);
    return res;
  } catch (err) {
    const { message } = err as Error;
    if (message && message.includes('tx already exists')) {
      const transactionHash = await computeTransactionHash(signedTx);
      return { transactionHash };
    }
    throw err;
  }
}
export function getSigningFunction({
  signingStargateClient,
  address,
  messages,
  fee,
  memo,
  accountNumber,
}: {
  signingStargateClient: SigningStargateClient,
  address: string,
  messages: EncodeObject[],
  fee: StdFee,
  memo: string,
  accountNumber: number,
}) {
  return ({ sequence }: { sequence: number; }) => signingStargateClient.sign(
    address,
    messages,
    fee,
    memo,
    {
      accountNumber,
      sequence,
      chainId: COSMOS_CHAIN_ID,
    },
  ) as Promise<TxRaw>;
}

export function getSendMessagesSigningFunction({
  iscnSigningClient,
  address,
  messages,
  accountNumber,
}: {
  iscnSigningClient: ISCNSigningClient,
  address: string,
  messages: EncodeObject[],
  accountNumber: number,
}) {
  return ({ sequence }: { sequence: number }) => iscnSigningClient.sendMessages(
    address,
    messages,
    {
      accountNumber,
      gasPrice: DEFAULT_GAS_PRICE,
      sequence,
      chainId: COSMOS_CHAIN_ID,
      broadcast: false,
    },
  ) as Promise<TxRaw>;
}

export async function sendTransactionWithSequence(
  senderAddress: string,
  signingFunction: ({ sequence }: { sequence: number }) => Promise<TxRaw>,
  client?: StargateClient,
) {
  let res;
  let signedTx;
  const { sequence: seq1 } = await getAccountInfo(senderAddress);
  const counterRef = txLogRef.doc(`!counter_${senderAddress}`);
  let pendingCount = await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const d = await t.get(counterRef);
    const data = d.data();
    if (!data) {
      const count = seq1.toNumber();
      await t.create(counterRef, { value: count + 1 });
      return count;
    }
    const v = (data.value as number) + 1;
    await t.update(counterRef, { value: v });
    return v - 1;
  });
  signedTx = await signingFunction({ sequence: pendingCount });
  try {
    res = await internalSendTransaction(signedTx, client);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const { message } = err as Error;
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
      res = await internalSendTransaction(signedTx, client);
    }
    await db.runTransaction(async (t: admin.firestore.Transaction) => {
      const d = await t.get(counterRef);
      const data = d.data();
      if (data && pendingCount + 1 > (data.value as number)) {
        await t.update(counterRef, {
          value: pendingCount + 1,
        });
      }
    });
    assertIsDeliverTxSuccess(res);
  } catch (err) {
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventCosmosError',
      fromWallet: senderAddress,
      txHash: (res || {}).transactionHash,
      txSequence: pendingCount,
      error: (err as string).toString(),
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

export function calculateTxGasFee(messageLength = 1, denom = COSMOS_DENOM) {
  const gas = DEFAULT_TRANSFER_GAS;
  const feeAmount = new BigNumber(gas)
    .multipliedBy(DEFAULT_GAS_PRICE).multipliedBy(messageLength).toFixed(0);
  return {
    amount: [{ denom, amount: feeAmount }],
    gas: new BigNumber(gas).multipliedBy(messageLength).toFixed(0),
  };
}

export function generateSendTxData(senderAddress, toAddress, amount) {
  const fee = calculateTxGasFee();
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
