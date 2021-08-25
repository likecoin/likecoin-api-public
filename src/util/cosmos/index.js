
import BigNumber from 'bignumber.js';
import bech32 from 'bech32';
import secp256k1 from 'secp256k1';
import createHash from 'create-hash';
import {
  COSMOS_LCD_ENDPOINT as cosmosLCDEndpoint,
  ISCN_DEV_LCD_ENDPOINT as iscnDevLCDEndpoint,
  COSMOS_RPC_ENDPOINT as cosmosRpcEndpoint,
  COSMOS_DENOM,
} from '../../../config/config';
import { createAPIEndpoint } from './api';

const api = createAPIEndpoint(cosmosLCDEndpoint);

function LIKEToNanolike(value) {
  return (new BigNumber(value)).multipliedBy(1e9).toFixed();
}

export function LIKEToAmount(value) {
  return { denom: COSMOS_DENOM, amount: LIKEToNanolike(value) };
}
export function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (new BigNumber(likecoin.amount)).dividedBy(1e9).toFixed();
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

export async function getCosmosTotalSupply() {
  const { data } = await api.get(`/cosmos/bank/v1beta1/supply/${COSMOS_DENOM}`);
  return amountToLIKE(data.amount);
}

export async function getCosmosAccountLIKE(address) {
  const { data } = await api.get(`/bank/balances/${address}`);
  if (!data.result || !data.result.length) return 0;
  const likecoin = data.result.find(c => c.denom === COSMOS_DENOM);
  return likecoin ? amountToLIKE(likecoin) : 0;
}

export function publicKeyBinaryToCosmosAddress(publicKey) {
  const sha256 = createHash('sha256');
  const ripemd = createHash('ripemd160');
  sha256.update(publicKey);
  ripemd.update(sha256.digest());
  const rawAddr = ripemd.digest();
  const cosmosAddress = bech32.encode('cosmos', bech32.toWords(rawAddr));
  return cosmosAddress;
}

export function verifyCosmosSignInPayload({
  signature, publicKey, message, cosmosWallet,
}) {
  const signatureBinary = Buffer.from(signature, 'base64');
  const publicKeyBinary = Buffer.from(publicKey, 'base64');
  const msgSha256 = createHash('sha256');
  msgSha256.update(message);
  const msgHash = msgSha256.digest();
  const valid = secp256k1.verify(msgHash, signatureBinary, publicKeyBinary)
    && publicKeyBinaryToCosmosAddress(publicKeyBinary) === cosmosWallet;
  return valid;
}

export const COSMOS_LCD_ENDPOINT = cosmosLCDEndpoint;

export const ISCN_LCD_ENDPOINT = iscnDevLCDEndpoint;

export const COSMOS_RPC_ENDPOINT = cosmosRpcEndpoint;
