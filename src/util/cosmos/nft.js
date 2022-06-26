
// eslint-disable-next-line import/no-extraneous-dependencies
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { ISCNQueryClient, ISCNSigningClient } from '@likecoin/iscn-js';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import { PageRequest } from 'cosmjs-types/cosmos/base/query/v1beta1/pagination';
import { getQueryClient } from '.';
import { getISCNPrefix } from './iscn';
import { LIKER_NFT_PRIVATE_KEY } from '../../../config/secret';
import { NFT_RPC_ENDPOINT } from '../../../config/config';

let queryClient = null;
let signingClient = null;
let signingWallet = null;
let signingAccountNumber = null;

export async function getNFTQueryClient() {
  if (!queryClient) {
    const client = new ISCNQueryClient();
    await client.connect(NFT_RPC_ENDPOINT);
    queryClient = client;
  }
  return queryClient;
}

export async function getNFTAccountInfo(address) {
  const q = await getQueryClient(NFT_RPC_ENDPOINT);
  const { value } = await q.auth.account(address);
  const accountInfo = BaseAccount.decode(value);
  return accountInfo;
}

export async function createNFTSigningClient(privateKey) {
  const privateKeyBytes = Buffer.from(privateKey, 'hex');
  const signer = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, 'like');
  const [wallet] = await signer.getAccounts();
  const client = new ISCNSigningClient();
  await client.connectWithSigner(NFT_RPC_ENDPOINT, signer);
  return { client, wallet };
}

export async function getNFTISCNData(iscnId) {
  const client = await getNFTQueryClient();
  const res = await client.queryRecordsById(iscnId);
  if (!res || !res.records || !res.records.length) return {};
  return {
    owner: res.owner,
    data: res.records[0].data,
  };
}

export async function getNFTISCNOwner(iscnId) {
  const res = await getNFTISCNData(iscnId);
  return res && res.owner;
}

export async function getISCNFromNFTClassId(classId) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.likenft.ISCNByClass(classId);
  if (!res) return null;
  const { iscnIdPrefix, owner } = res;
  return {
    iscnIdPrefix,
    owner,
  };
}

export async function getNFTClassDataById(classId) {
  const client = await getNFTQueryClient();
  const res = await client.queryNFTClass(classId);
  if (!res) return null;
  return res.class;
}

export async function getNFTsByClassId(classId, address) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  let nfts = [];
  let next = new Uint8Array([0x00]);
  do {
    /* eslint-disable no-await-in-loop */
    const res = await client.nft.NFTs(classId, address, PageRequest.fromPartial({ key: next }));
    ({ nextKey: next } = res.pagination);
    nfts = nfts.concat(res.nfts);
  } while (next && next.length);
  const nftIds = nfts.map(n => n.id);
  return { nftIds, nfts };
}

export async function getNFTClassIdByISCNId(iscnId) {
  const iscnPrefix = getISCNPrefix(iscnId);
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.likenft.classesByISCN(iscnPrefix);
  if (!res || !res.classes || !res.classes[0]) return '';
  return res.classes[0].id;
}

export async function getNFTOwner(classId, nftId) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.nft.owner(classId, nftId);
  return res.owner;
}

export async function getLikerNFTSigningClient() {
  if (!signingClient) {
    const { client, wallet } = await createNFTSigningClient(LIKER_NFT_PRIVATE_KEY);
    signingWallet = wallet;
    signingClient = client;
  }
  return signingClient;
}

export async function getLikerNFTSigningAddressInfo() {
  if (!signingWallet) await getLikerNFTSigningClient();
  if (!signingAccountNumber) {
    const { accountNumber } = await getNFTAccountInfo(signingWallet.address);
    signingAccountNumber = accountNumber;
  }
  return {
    address: signingWallet.address,
    accountNumber: signingAccountNumber,
  };
}
