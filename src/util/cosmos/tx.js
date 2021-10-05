// eslint-disable-next-line import/no-extraneous-dependencies
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { StargateClient } from '@cosmjs/stargate';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';

const {
  COSMOS_DENOM,
  COSMOS_RPC_ENDPOINT,
} = require('../../../config/config');

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

export default queryLIKETransactionInfo;
