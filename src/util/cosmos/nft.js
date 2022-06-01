import { getISCNQueryClient, createISCNSigningClient } from './iscn';
import { getAccountInfo } from '.';
import { LIKER_NFT_PRIVATE_KEY } from '../../../config/secret';

let signingClient = null;
let signingWallet = null;
let signingAccountNumber = null;

export async function getISCNFromNFTClassId(classId) {
  const c = await getISCNQueryClient();
  const client = await c.getQueryClient();
  const res = await client.likenft.ISCNByClass(classId);
  if (!res) return null;
  const { iscnIdPrefix, owner } = res;
  return {
    iscnIdPrefix,
    owner,
  };
}

export async function getLikerNFTSigningClient() {
  if (!signingClient) {
    const { client, wallet } = await createISCNSigningClient(LIKER_NFT_PRIVATE_KEY);
    signingWallet = wallet;
    signingClient = client;
  }
  return signingClient;
}

export async function getLikerNFTSigningAddressInfo() {
  if (!signingWallet) await getLikerNFTSigningClient();
  if (!signingAccountNumber) {
    const { accountNumber } = await getAccountInfo(signingWallet.address);
    signingAccountNumber = accountNumber;
  }
  return {
    address: signingWallet.address,
    accountNumber: signingAccountNumber,
  };
}
