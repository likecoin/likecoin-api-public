import { BigNumber } from 'bignumber.js';
import { readContract } from 'viem/actions';
import type { Abi } from 'viem';
import {
  LIKE_COIN_V3_ABI,
  LIKE_COIN_V3_ADDRESS,
  LIKE_COIN_V3_DECIMALS,
} from '../../constant/contract/likecoinV3';
import { getEVMClient, getEVMWalletAccount, getEVMWalletClient } from './client';
import { sendWriteContractWithNonce } from './tx';
import config from '../../../config/config';

// The constant is valid on both mainnet and testnet; config can override it.
// Every LIKE token call resolves through here,
// so the token can't end up split across two addresses in one process.
export function getLikeCoinAddress(): `0x${string}` {
  return (config.LIKE_COIN_V3_ADDRESS_OVERRIDE || LIKE_COIN_V3_ADDRESS) as `0x${string}`;
}

export function LIKEToTokenAmount(amountInLIKE: BigNumber.Value): bigint {
  const raw = new BigNumber(amountInLIKE)
    .multipliedBy(new BigNumber(10).pow(LIKE_COIN_V3_DECIMALS));
  return BigInt(raw.integerValue(BigNumber.ROUND_FLOOR).toFixed());
}

export async function getLIKEBalance(address: string): Promise<bigint> {
  return await readContract(getEVMClient(), {
    address: getLikeCoinAddress(),
    abi: LIKE_COIN_V3_ABI as Abi,
    functionName: 'balanceOf',
    args: [address],
  }) as bigint;
}

export async function getAPIWalletLIKEBalance(): Promise<bigint> {
  return getLIKEBalance(getEVMWalletAccount().address);
}

// Returns once the transfer is broadcast, not once it is confirmed: callers run
// inside the Stripe webhook, where waiting out two Base confirmations costs
// seconds of the response budget.
// The raw signed tx comes back so a caller can persist it; a broadcast that is
// later dropped can then be re-sent as-is instead of rebuilt by hand.
export async function transferLIKE(
  to: `0x${string}`,
  amount: bigint,
): Promise<{ txHash: string | null; rawSignedTx: string; nonce: number }> {
  const walletClient = getEVMWalletClient();
  const account = getEVMWalletAccount();
  const txData = await sendWriteContractWithNonce(walletClient, {
    chain: walletClient.chain,
    address: getLikeCoinAddress(),
    abi: LIKE_COIN_V3_ABI as Abi,
    account,
    functionName: 'transfer',
    args: [to, amount],
  }, { waitForReceipt: false });
  return {
    txHash: txData.transactionHash || null,
    rawSignedTx: txData.tx,
    nonce: txData.nonce,
  };
}

export default transferLIKE;
