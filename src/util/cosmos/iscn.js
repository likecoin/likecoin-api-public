// eslint-disable-next-line import/no-extraneous-dependencies
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { ISCNQueryClient, ISCNSigningClient } from '@likecoin/iscn-js';
import { getAccountInfo } from '.';
import { COSMOS_PRIVATE_KEY } from '../../../config/secret';
import {
  COSMOS_RPC_ENDPOINT,
} from '../../../config/config';

export { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/parsing';

let queryClient = null;
let signingClient = null;
let signingWallet = null;
let signingAccountNumber = null;

export async function getISCNQueryClient() {
  if (!queryClient) {
    const client = new ISCNQueryClient();
    await client.connect(COSMOS_RPC_ENDPOINT);
    queryClient = client;
  }
  return queryClient;
}

export async function createISCNSigningClient(privateKey) {
  const privateKeyBytes = Buffer.from(privateKey, 'hex');
  const signer = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, 'like');
  const [wallet] = await signer.getAccounts();
  const client = new ISCNSigningClient();
  await client.connectWithSigner(COSMOS_RPC_ENDPOINT, signer);
  return { client, wallet };
}

export async function getISCNSigningClient() {
  if (!signingClient) {
    const { client, wallet } = await createISCNSigningClient(COSMOS_PRIVATE_KEY);
    signingWallet = wallet;
    signingClient = client;
  }
  return signingClient;
}

export async function getISCNSigningAddressInfo() {
  if (!signingWallet) await getISCNSigningClient();
  if (!signingAccountNumber) {
    const { accountNumber } = await getAccountInfo(signingWallet.address);
    signingAccountNumber = accountNumber;
  }
  return {
    address: signingWallet.address,
    accountNumber: signingAccountNumber,
  };
}

export async function getISCNOwner(iscnId) {
  const client = await getISCNQueryClient();
  const res = await client.queryRecordsById(iscnId);
  return res && res.owner;
}

export async function getISCNStakeholders(iscnId) {
  const client = await getISCNQueryClient();
  const res = await client.queryRecordsById(iscnId);
  return res && res.records[0];
}

export function getISCNPrefix(input) {
  const res = /^(iscn:\/\/likecoin-chain\/[A-Za-z0-9-]+)\/[0-9]+$/.exec(input);
  if (!res) return input;
  const [, prefix] = res;
  return prefix;
}
