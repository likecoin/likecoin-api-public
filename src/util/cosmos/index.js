
import BigNumber from 'bignumber.js';
import bech32 from 'bech32';
import secp256k1 from 'secp256k1';
import createHash from 'create-hash';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import {
  QueryClient,
  setupAuthExtension,
  setupBankExtension,
} from '@cosmjs/stargate';
import {
  COSMOS_LCD_ENDPOINT as cosmosLCDEndpoint,
  ISCN_DEV_LCD_ENDPOINT as iscnDevLCDEndpoint,
  COSMOS_RPC_ENDPOINT as cosmosRpcEndpoint,
  COSMOS_CHAIN_ID as cosmosChainId,
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
  if (likecoin.denom === COSMOS_DENOM) {
    return (new BigNumber(likecoin.amount)).dividedBy(1e9).toFixed();
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

export async function getCosmosTotalSupply() {
  const { data } = await api.get(`/cosmos/bank/v1beta1/supply/${COSMOS_DENOM}`);
  return amountToLIKE(data.amount);
}

let cosmosQueryClient = null;

async function getQueryClient() {
  if (!cosmosQueryClient) {
    const tendermint34Client = await Tendermint34Client.connect(cosmosRpcEndpoint);
    const queryClient = QueryClient.withExtensions(
      tendermint34Client,
      setupAuthExtension,
      setupBankExtension,
    );
    cosmosQueryClient = queryClient;
  }
  return cosmosQueryClient;
}

export async function getCosmosAccountLIKE(address) {
  const queryClient = await getQueryClient();
  const { amount } = await queryClient.bank.balance(address, COSMOS_DENOM);
  return new BigNumber(amount).shiftedBy(-9).toFixed();
}

export async function getAccountInfo(address) {
  const queryClient = await getQueryClient();
  const { value } = await queryClient.auth.account(address);
  const accountInfo = BaseAccount.decode(value);
  return accountInfo;
}

export function publicKeyBinaryToAddresses(publicKey) {
  const sha256 = createHash('sha256');
  const ripemd = createHash('ripemd160');
  sha256.update(publicKey);
  ripemd.update(sha256.digest());
  const rawAddr = ripemd.digest();
  const cosmosAddress = bech32.encode('cosmos', bech32.toWords(rawAddr));
  const likeAddress = bech32.encode('like', bech32.toWords(rawAddr));
  return { cosmosAddress, likeAddress };
}

export function verifyCosmosSignInPayload({
  signature, publicKey, message, inputWallet,
}) {
  const signatureBinary = Buffer.from(signature, 'base64');
  const publicKeyBinary = Buffer.from(publicKey, 'base64');
  const msgSha256 = createHash('sha256');
  msgSha256.update(message);
  const msgHash = msgSha256.digest();
  const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKeyBinary);
  const valid = secp256k1.verify(msgHash, signatureBinary, publicKeyBinary)
    && (cosmosAddress === inputWallet || likeAddress === inputWallet);
  return valid;
}

export function convertAddressPrefix(address, prefix = 'like') {
  const { words } = bech32.decode(address);
  return bech32.encode(prefix, words);
}

export const COSMOS_LCD_ENDPOINT = cosmosLCDEndpoint;

export const ISCN_LCD_ENDPOINT = iscnDevLCDEndpoint;

export const COSMOS_RPC_ENDPOINT = cosmosRpcEndpoint;

export const COSMOS_CHAIN_ID = cosmosChainId;
