import { readContract } from 'viem/actions';
import { getEvmClient } from './client';
import { LIKE_NFT_CLASS_ABI } from './LikeNFT';

export async function getNFTClassOwner(classId) {
  const owner = await readContract(getEvmClient(), {
    address: classId,
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'owner',
  });
  return owner as string;
}

export async function getNFTOwner(classId, tokenId: number) {
  const owner = await readContract(getEvmClient(), {
    address: classId,
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  return owner as string;
}

export async function getNFTClassDataById(classId) {
  const dataString = await readContract(getEvmClient(), {
    address: classId,
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'contractURI',
  }) as string;
  if (!(dataString)?.startsWith('data:application/json')) {
    throw new Error('Invalid data');
  }
  return JSON.parse(dataString.replace('data:application/json;utf8,', ''));
}
