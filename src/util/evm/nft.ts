/* eslint-disable camelcase */
import { readContract } from 'viem/actions';
import { getAddress } from 'viem';
import axios from 'axios';
import { getEVMClient, getEVMWalletAccount, getEVMWalletClient } from './client';
import { LIKE_NFT_ABI, LIKE_NFT_CLASS_ABI, LIKE_NFT_CONTRACT_ADDRESS } from './LikeNFT';
import { sendWriteContractWithNonce } from './tx';
import { logEVMMintNFTsTx } from '../txLogger';
import { BOOK3_HOSTNAME } from '../../constant';
import {
  LIKE_NFT_EVM_INDEXER_API,
  LIKE_NFT_EVM_INDEXER_API_KEY,
} from '../../../config/config';

interface PaginationResponse {
  next_key: number;
  count: number;
}

interface Account {
  id: number;
  cosmos_address?: string;
  evm_address: string;
  likeid?: string;
}

interface Erc721MetadataAttribute {
  display_type?: 'number' | 'boost_number' | 'boost_percentage';
  trait_type: string;
  value: string;
}

interface NFT {
  id: number;
  contract_address: string;
  token_id: string;
  token_uri?: string;
  image?: string;
  image_data?: string;
  external_url?: string;
  description?: string;
  name?: string;
  attributes?: Erc721MetadataAttribute[];
  background_color?: string;
  animation_url?: string;
  youtube_url?: string;
  owner_address: string;
  minted_at: string;
  updated_at: string;
}

interface BookNFTTokensResponse {
  pagination: PaginationResponse;
  data: NFT[];
}

interface IndexerActionResponse {
  message: string;
  task_id?: string;
}

interface ContractLevelMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  banner_image?: string;
  featured_image?: string;
  external_link?: string;
  collaborators?: string[];
  [key: string]: any;
}

interface BookNFT {
  id: number;
  address: string;
  name: string;
  symbol: string;
  owner_address?: string;
  total_supply: string;
  max_supply: string;
  metadata?: ContractLevelMetadata;
  banner_image: string;
  featured_image: string;
  deployer_address: string;
  deployed_block_number: string;
  minted_at: string;
  updated_at: string;
  owner?: Account;
}

interface BookNFTResponse {
  pagination: PaginationResponse;
  data: BookNFT[];
}

interface AccountResponse {
  account: Account;
}

export function isEVMClassId(classId) {
  return classId.startsWith('0x');
}

export async function getNFTClassOwner(classId) {
  const owner = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'owner',
  });
  return owner as string;
}

export async function getNFTOwner(classId, tokenId: number) {
  const owner = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  return owner as string;
}

export async function getNFTClassDataById(classId) {
  let dataString = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'contractURI',
  }) as string;
  const dataUriPattern = /^data:application\/json(?:; ?charset=utf-8|; ?utf8)?(;base64)?,/i;
  const match = dataString.match(dataUriPattern);
  if (!match) {
    throw new Error('Invalid data');
  }
  const isBase64 = !!match[1];
  dataString = dataString.replace(dataUriPattern, '');
  if (isBase64) {
    dataString = Buffer.from(dataString, 'base64').toString('utf-8');
  }
  return JSON.parse(dataString);
}

export async function getNFTClassBalanceOf(classId, wallet) {
  const balance = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'balanceOf',
    args: [getAddress(wallet)],
  });
  return balance as number;
}

export async function getNFTClassTokenIdByOwnerIndex(classId, wallet, index) {
  const tokenId = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'tokenOfOwnerByIndex',
    args: [getAddress(wallet), index],
  });
  return tokenId as number;
}

export async function getClassCurrentTokenId(classId) {
  const tokenId = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'getCurrentIndex',
  });
  return tokenId as number;
}

export async function checkNFTClassIsBookNFT(classId) {
  const res = await readContract(getEVMClient(), {
    address: LIKE_NFT_CONTRACT_ADDRESS,
    abi: LIKE_NFT_ABI,
    functionName: 'isBookNFT',
    args: [classId],
  });
  return res as boolean;
}

export async function listNFTTokenOwner(classId: string, {
  limit = 100,
  key = '',
}: {
  limit?: number;
  key?: string;
} = {}): Promise<BookNFTTokensResponse> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknft/${classId}/tokens?${queryParams.toString()}`,
  );
  return data;
}

export async function triggerNFTIndexerUpdate({ classId = '' }: {
  classId?: string;
} = {}): Promise<IndexerActionResponse | null> {
  if (!LIKE_NFT_EVM_INDEXER_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('LIKE_NFT_EVM_INDEXER_API_KEY is not set, skipping indexer update');
    return null;
  }
  const path = classId ? `/index-action/book-nft/${classId}` : '/index-action/like-protocol';
  const { data } = await axios.post(`${LIKE_NFT_EVM_INDEXER_API}${path}`, {}, {
    headers: {
      'X-Index-Action-Api-Key': LIKE_NFT_EVM_INDEXER_API_KEY,
    },
  });
  return data;
}

export async function mintNFT(
  classId,
  wallet,
  metadata,
  { count = 1, memo = '', fromTokenId }: {
    count?: number,
    memo?: string,
    fromTokenId?: number,
  } = {},
) {
  const account = getEVMWalletAccount();
  const walletClient = getEVMWalletClient();
  const isBookNFT = await checkNFTClassIsBookNFT(classId);
  if (!isBookNFT) { throw new Error(`Class ${classId} is not a book NFT`); }
  const isMintFromTokenId = fromTokenId !== undefined;
  const args: any[] = [
    Array(count).fill(getAddress(wallet)),
    Array(count).fill(memo),
    Array(count).fill(0).map((_, index) => {
      let { name, description, external_url: externalUrl } = metadata;
      if (isMintFromTokenId) {
        const tokenId = Number(fromTokenId) + index;
        description = `Copy #${tokenId} of ${name}`;
        name = `${name} #${tokenId}`;
        externalUrl = `https://${BOOK3_HOSTNAME}/store/${classId}/${tokenId}`;
      }
      return JSON.stringify({
        ...metadata,
        name,
        description,
        external_url: externalUrl,
      });
    }),
  ];
  if (isMintFromTokenId) {
    args.unshift(fromTokenId);
  }
  const res = await sendWriteContractWithNonce(walletClient, {
    chain: walletClient.chain,
    address: classId,
    abi: LIKE_NFT_CLASS_ABI,
    account,
    functionName: isMintFromTokenId ? 'safeMintWithTokenId' : 'batchMint',
    args,
  });
  await logEVMMintNFTsTx({
    txHash: res.transactionHash,
    chainId: walletClient.chain.id,
    rawSignedTx: res.tx,
    from: account.address,
    nonce: res.nonce,
    to: LIKE_NFT_CONTRACT_ADDRESS,
  });
  return res.transactionHash;
}

export async function getBookNFTsByAccount(evmAddress: string, {
  limit = 100,
  key = '',
  reverse = false,
}: {
  limit?: number;
  key?: string;
  reverse?: boolean;
} = {}): Promise<BookNFTResponse> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  if (reverse) queryParams.append('reverse', String(reverse));

  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/account/${evmAddress}/booknfts?${queryParams.toString()}`,
  );
  return data;
}

export async function getTokensByAccount(evmAddress: string, {
  limit = 100,
  key = '',
  reverse = false,
}: {
  limit?: number;
  key?: string;
  reverse?: boolean;
} = {}): Promise<BookNFTTokensResponse> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  if (reverse) queryParams.append('reverse', String(reverse));

  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/account/${evmAddress}/tokens?${queryParams.toString()}`,
  );
  return data;
}

export async function getTokenBookNFTsByAccount(evmAddress: string, {
  limit = 100,
  key = '',
  reverse = false,
}: {
  limit?: number;
  key?: string;
  reverse?: boolean;
} = {}): Promise<BookNFTResponse> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  if (reverse) queryParams.append('reverse', String(reverse));

  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/account/${evmAddress}/token-booknfts?${queryParams.toString()}`,
  );
  return data;
}

export async function getAllBookNFTs({
  limit = 100,
  key = '',
  reverse = false,
}: {
  limit?: number;
  key?: string;
  reverse?: boolean;
} = {}): Promise<BookNFTResponse> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  if (reverse) queryParams.append('reverse', String(reverse));

  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknfts?${queryParams.toString()}`,
  );
  return data;
}

export async function getBookNFTById(id: string): Promise<BookNFT> {
  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknft/${id}`,
  );
  return data;
}

export async function getTokenAccountsByBookNFT(id: string, {
  limit = 100,
  key = '',
  reverse = false,
}: {
  limit?: number;
  key?: string;
  reverse?: boolean;
} = {}): Promise<{ pagination: PaginationResponse; data: Account[] }> {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  if (reverse) queryParams.append('reverse', String(reverse));

  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknft/${id}/tokens/account?${queryParams.toString()}`,
  );
  return data;
}

export async function getAccountByBookNFT(id: string): Promise<AccountResponse> {
  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknft/${id}/account`,
  );
  return data;
}

export async function getTokenById(booknftId: string, tokenId: string): Promise<NFT> {
  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/token/${booknftId}/${tokenId}`,
  );
  return data;
}
