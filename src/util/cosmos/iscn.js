// eslint-disable-next-line import/no-extraneous-dependencies
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { ISCNQueryClient, ISCNSigningClient } from '@likecoin/iscn-js';

import { COSMOS_PRIVATE_KEY } from '../../../config/secret';
import {
  COSMOS_RPC_ENDPOINT,
} from '../../../config/config';

let queryClient = null;
let signingClient = null;
let signingWallet = null;

export async function getISCNQueryClient() {
  if (!queryClient) {
    const client = new ISCNQueryClient();
    await client.connect(COSMOS_RPC_ENDPOINT);
    queryClient = client;
  }
  return queryClient;
}

export async function getISCNSigningClient() {
  if (!signingClient) {
    const privateKeyBytes = Buffer.from(COSMOS_PRIVATE_KEY, 'hex');
    const signer = await DirectSecp256k1Wallet.fromKey(privateKeyBytes);
    const [wallet] = await signer.getAccounts();
    const client = new ISCNSigningClient();
    await client.connectWithSigner(COSMOS_RPC_ENDPOINT, signer);
    signingWallet = wallet;
    signingClient = client;
  }
  return signingClient;
}

export async function getISCNSigningAddress() {
  if (!signingWallet) return '';
  return signingWallet.address;
}
