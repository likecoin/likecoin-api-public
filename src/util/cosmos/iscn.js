import jsonStringify from 'fast-json-stable-stringify';
import createHash from 'create-hash';
import secp256k1 from 'secp256k1';

import { COSMOS_PRIVATE_KEY } from '../../../config/secret';
import {
  ISCN_DEV_CHAIN_ID,
  ISCN_DEV_LCD_ENDPOINT as iscnDevLCDEndpoint,
  COSMOS_DENOM,
} from '../../../config/config';
import { createAPIEndpoint } from './api';
import { publicKeyBinaryToCosmosAddress } from '.';

const api = createAPIEndpoint(iscnDevLCDEndpoint);

export async function getAccountInfo(address) {
  const res = await api.get(`/auth/accounts/${address}`);
  if (res.data.result) {
    return res.data.result.value;
  }
  return res.data.value;
}

function createSigner(privateKey) {
  const publicKey = secp256k1.publicKeyCreate(privateKey, true);
  const cosmosAddress = publicKeyBinaryToCosmosAddress(publicKey);
  const sign = (msg) => {
    const msgSha256 = createHash('sha256');
    msgSha256.update(msg);
    const msgHash = msgSha256.digest();
    const { signature } = secp256k1.sign(msgHash, privateKey);
    return { signature, publicKey };
  };
  return { cosmosAddress, sign };
}
const cosmosSigner = createSigner(COSMOS_PRIVATE_KEY);

export function getCosmosDelegatorAddress() {
  return cosmosSigner.cosmosAddress;
}

export function signTransaction({
  signer,
  accNum,
  stdTx: inputStdTx,
  sequence,
}) {
  const stdTx = { ...inputStdTx };
  const signMessage = jsonStringify({
    fee: stdTx.fee,
    msgs: stdTx.msg,
    chain_id: ISCN_DEV_CHAIN_ID,
    account_number: accNum,
    sequence: sequence.toString(),
    memo: stdTx.memo,
  });
  const { signature, publicKey } = signer.sign(Buffer.from(signMessage, 'utf-8'));
  stdTx.signatures = [{
    signature: signature.toString('base64'),
    account_number: accNum,
    sequence: sequence.toString(),
    pub_key: {
      type: 'tendermint/PubKeySecp256k1',
      value: publicKey.toString('base64'),
    },
  }];
  return stdTx;
}

export async function signISCNTransaction(iscnPayload) {
  const { sequence, account_number: accNum } = await getAccountInfo(cosmosSigner.cosmosAddress);
  const gas = '200000';
  const feeAmount = '0';
  const stdTx = {
    msg: [iscnPayload],
    fee: {
      amount: [{ denom: COSMOS_DENOM, amount: feeAmount }],
      gas,
    },
    memo: 'iscn-dev',
  };
  const signed = await signTransaction({
    signer: cosmosSigner,
    accNum,
    stdTx,
    sequence,
  });
  return signed;
}
