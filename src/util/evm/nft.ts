import { readContract } from 'viem/actions';
import { getAddress } from 'viem';
import { getEvmClient } from './client';
import { LIKE_NFT_ABI, LIKE_NFT_CLASS_ABI, LIKE_NFT_CONTRACT_ADDRESS } from './LikeNFT';

export function isEVMClassId(classId) {
  return classId.startsWith('0x');
}

export async function getNFTClassOwner(classId) {
  const owner = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'owner',
  });
  return owner as string;
}

export async function getNFTOwner(classId, tokenId: number) {
  const owner = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  return owner as string;
}

export async function getNFTClassDataById(classId) {
  const dataString = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'contractURI',
  }) as string;
  if (!(dataString)?.startsWith('data:application/json')) {
    throw new Error('Invalid data');
  }
  return JSON.parse(dataString.replace('data:application/json;utf8,', ''));
}

export async function getNFTClassBalanceOf(classId, wallet) {
  const balance = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'balanceOf',
    args: [getAddress(wallet)],
  });
  return balance as number;
}

export async function getNFTClassTokenIdByOwnerIndex(classId, wallet, index) {
  const tokenId = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'tokenOfOwnerByIndex',
    args: [getAddress(wallet), index],
  });
  return tokenId as number;
}

export async function checkNFTClassIsBookNFT(classId) {
  const res = await readContract(getEvmClient(), {
    address: LIKE_NFT_CONTRACT_ADDRESS,
    abi: LIKE_NFT_ABI,
    functionName: 'isBookNFT',
    args: [classId],
  });
  return res as boolean;
}
