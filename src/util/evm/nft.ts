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
  const dataString = await readContract(getEVMClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'contractURI',
  }) as string;
  const dataUriPattern = /^data:application\/json(;charset=utf-8|;utf8)?,/i;
  if (!dataUriPattern.test(dataString)) {
    throw new Error('Invalid data');
  }
  return JSON.parse(dataString.replace(dataUriPattern, ''));
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

export async function listNFTTokenOwner(classId, {
  limit = 100,
  key = '',
} = {}) {
  const queryParams = new URLSearchParams();
  if (limit) queryParams.append('pagination.limit', String(limit));
  if (key) queryParams.append('pagination.key', key);
  const { data } = await axios.get(
    `${LIKE_NFT_EVM_INDEXER_API}/booknft/${classId}/tokens?${queryParams.toString()}`,
  );
  return data;
}

export async function triggerNFTIndexerUpdate({ classId = '' } = {}) {
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
        name = `${name} #${tokenId}`;
        description = `Copy #${tokenId} of ${name}`;
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
