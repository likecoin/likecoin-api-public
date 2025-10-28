import { BigNumber } from 'bignumber.js';
import { readContract } from 'viem/actions';
import type { Abi } from 'viem';
import { LIKE_COLLECTIVE_ABI, LIKE_COLLECTIVE_ADDRESS } from '../../constant/contract/likeCollective';
import { getEVMClient, getEVMWalletClient, getEVMWalletAccount } from './client';
import { sendWriteContractWithNonce } from './tx';
import { LIKER_NFT_FIAT_MIN_RATIO } from '../../../config/config';
import publisher from '../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { LIKE_COIN_V3_ABI, LIKE_COIN_V3_ADDRESS, LIKE_COIN_V3_DECIMALS } from '../../constant/contract/likecoinV3';

export async function getLikeCollectiveTotalStake(
  nftClassId: string,
): Promise<bigint> {
  const publicClient = getEVMClient();
  try {
    const totalStake = await readContract(publicClient, {
      address: LIKE_COLLECTIVE_ADDRESS,
      abi: LIKE_COLLECTIVE_ABI as Abi,
      functionName: 'getTotalStake',
      args: [nftClassId],
    }) as bigint;
    return totalStake;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `Failed to get LikeCollective total stake for ${nftClassId}:`,
      error,
    );
    throw error;
  }
}

export function calculateLikeCollectiveRewardAmount(
  priceInDecimal: number,
  customPriceDiffInDecimal = 0,
  likePrice: number = LIKER_NFT_FIAT_MIN_RATIO,
): bigint {
  if (!priceInDecimal || priceInDecimal <= customPriceDiffInDecimal) {
    return 0n;
  }
  const netAmountInCents = new BigNumber(priceInDecimal)
    .minus(customPriceDiffInDecimal);

  const rewardInCents = netAmountInCents.multipliedBy(0.05);
  const rewardInUSD = rewardInCents.dividedBy(100);
  const rewardInLIKE = rewardInUSD.dividedBy(likePrice);
  const rewardInTokens = rewardInLIKE.multipliedBy(
    new BigNumber(10).pow(LIKE_COIN_V3_DECIMALS),
  );

  return BigInt(rewardInTokens.integerValue().toString());
}

export async function hasLIKEBalance(requiredAmount: bigint): Promise<boolean> {
  try {
    const publicClient = getEVMClient();
    const account = getEVMWalletAccount();

    const balance = await readContract(publicClient, {
      address: LIKE_COIN_V3_ADDRESS,
      abi: LIKE_COIN_V3_ABI as Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;

    return balance > requiredAmount;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      'Failed to check LIKE balance, assuming insufficient funds:',
      error,
    );
    return false;
  }
}

export async function getLIKEAllowance(): Promise<bigint> {
  try {
    const publicClient = getEVMClient();
    const account = getEVMWalletAccount();

    const allowance = await readContract(publicClient, {
      address: LIKE_COIN_V3_ADDRESS,
      abi: LIKE_COIN_V3_ABI as Abi,
      functionName: 'allowance',
      args: [account.address, LIKE_COLLECTIVE_ADDRESS],
    }) as bigint;

    return allowance;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      'Failed to check LIKE allowance:',
      error,
    );
    throw error;
  }
}

export async function approveLIKEForLikeCollective(): Promise<string | null> {
  try {
    const walletClient = getEVMWalletClient();
    const account = getEVMWalletAccount();

    // Approve max uint256 amount
    const maxApproval = (BigInt(2) ** BigInt(256)) - BigInt(1);

    const txData = await sendWriteContractWithNonce(walletClient, {
      chain: walletClient.chain,
      address: LIKE_COIN_V3_ADDRESS,
      abi: LIKE_COIN_V3_ABI as Abi,
      account,
      functionName: 'approve',
      args: [LIKE_COLLECTIVE_ADDRESS, maxApproval],
    });

    const txHash = ((txData as Record<string, unknown>).transactionHash as string | null) || null;

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'likeCollectiveApprovalTx',
      approvalAmount: maxApproval.toString(),
      txHash,
    });

    return txHash;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      'Failed to approve LIKE for LikeCollective contract:',
      error,
    );

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'likeCollectiveApprovalError',
      error: (error as Error).toString(),
    });

    throw error;
  }
}

export async function depositLikeCollectiveReward(
  bookNFTAddress: string,
  priceInDecimal: number,
  customPriceDiffInDecimal = 0,
  likePrice: number = LIKER_NFT_FIAT_MIN_RATIO,
): Promise<string | null> {
  try {
    if (!priceInDecimal || priceInDecimal <= customPriceDiffInDecimal) {
      return null;
    }

    const totalStake = await getLikeCollectiveTotalStake(bookNFTAddress);

    if (totalStake <= 0n) {
      return null;
    }

    const rewardAmount = calculateLikeCollectiveRewardAmount(
      priceInDecimal,
      customPriceDiffInDecimal,
      likePrice,
    );

    if (rewardAmount <= 0n) {
      return null;
    }

    const hasBalance = await hasLIKEBalance(rewardAmount);
    if (!hasBalance) {
      // eslint-disable-next-line no-console
      console.warn(
        'API wallet has insufficient LIKE balance for reward deposit. '
        + `Required: ${rewardAmount.toString()}, ClassId: ${bookNFTAddress}`,
      );
      return null;
    }

    // Check and ensure sufficient allowance
    const currentAllowance = await getLIKEAllowance();
    if (currentAllowance < rewardAmount) {
      // eslint-disable-next-line no-console
      console.info(
        `Current LIKE allowance (${currentAllowance.toString()}) is insufficient for reward amount (${rewardAmount.toString()}). `
        + 'Approving max amount to LikeCollective contract...',
      );
      const approvalTxHash = await approveLIKEForLikeCollective();
      // eslint-disable-next-line no-console
      console.info(
        `LIKE approval transaction submitted: ${approvalTxHash}`,
      );
    }

    const walletClient = getEVMWalletClient();
    const account = getEVMWalletAccount();

    const txData = await sendWriteContractWithNonce(walletClient, {
      chain: walletClient.chain,
      address: LIKE_COLLECTIVE_ADDRESS,
      abi: LIKE_COLLECTIVE_ABI as Abi,
      account,
      functionName: 'depositReward',
      args: [bookNFTAddress, rewardAmount],
    });

    const txHash = ((txData as Record<string, unknown>).transactionHash as string | null) || null;

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'likeCollectiveRewardDeposit',
      bookNFTAddress,
      rewardAmountInLIKE: rewardAmount.toString(),
      priceInUSD: (priceInDecimal / 100).toString(),
      customPriceDiffInUSD: (customPriceDiffInDecimal / 100).toString(),
      likePrice: likePrice.toString(),
      txHash,
    });

    return txHash;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `Failed to deposit LikeCollective reward for ${bookNFTAddress}:`,
      error,
    );

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'likeCollectiveRewardDepositError',
      bookNFTAddress,
      rewardAmountInLIKE: calculateLikeCollectiveRewardAmount(
        priceInDecimal,
        customPriceDiffInDecimal,
        likePrice,
      ).toString(),
      priceInUSD: (priceInDecimal / 100).toString(),
      customPriceDiffInUSD: (customPriceDiffInDecimal / 100).toString(),
      error: (error as Error).toString(),
    });

    return null;
  }
}
