import { readContract } from 'viem/actions';
import { getAddress } from 'viem';
import { getEvmClient, getEvmWalletAccount, getEvmWalletClient } from './client';
import { LIKE_NFT_ABI, LIKE_NFT_CLASS_ABI, LIKE_NFT_CONTRACT_ADDRESS } from './LikeNFT';
import { sendWriteContractWithNonce } from './tx';
import { logEvmMintNFTsTx } from '../txLogger';

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

export async function getClassCurrentTokenId(classId) {
  const tokenId = await readContract(getEvmClient(), {
    address: getAddress(classId),
    abi: LIKE_NFT_CLASS_ABI,
    functionName: 'currentTokenId',
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
  const account = getEvmWalletAccount();
  const walletClient = getEvmWalletClient();
  const isBookNFT = await checkNFTClassIsBookNFT(classId);
  if (!isBookNFT) { throw new Error(`Class ${classId} is not a book NFT`); }
  const isMintFromTokenId = fromTokenId !== undefined;
  const args: any[] = [
    Array(count).fill(getAddress(wallet)),
    Array(count).fill(memo),
    Array(count).fill(0).map((_, index) => {
      let { name } = metadata;
      if (isMintFromTokenId) {
        name = `${name} #${fromTokenId + index + 1}`;
      }
      return JSON.stringify({ ...metadata, name });
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
    functionName: fromTokenId ? 'safeMintWithTokenId' : 'batchMint',
    args,
  });
  await logEvmMintNFTsTx({
    txHash: res.transactionHash,
    chainId: walletClient.chain.id,
    rawSignedTx: res.tx,
    from: account.address,
    nonce: res.nonce,
    to: LIKE_NFT_CONTRACT_ADDRESS,
  });
  return res.transactionHash;
}
