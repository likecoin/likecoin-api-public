import { BigNumber } from 'bignumber.js';
import { PUBSUB_TOPIC_MISC } from '../constant';
import type { admin } from './firebase';
import publisher from './gcloudPub';
import { isValidEVMAddress } from './evm';
import {
  LIKEToTokenAmount,
  getAPIWalletLIKEBalance,
  transferLIKE,
} from './evm/likeCoin';
import { getLIKEPrice } from './api/likernft/likePrice';

// Also the pubsub logType prefix; the InsufficientBalance/Error variants derive from it.
export type AirdropLogType = 'BookPurchaseAirdrop' | 'PlusSubscriptionAirdrop';

// Repeated at the use site rather than relying on config/config.js alone: the
// deployed config shadows the repo one, so a key is undefined until added there.
export function getAirdropRatio(configured: unknown, fallback = 0.01): number {
  return typeof configured === 'number' ? configured : fallback;
}

// Whole LIKE only, since the buyer-facing number is never a fraction.
// Floors rather than rounds, so a payout never exceeds the ratio promised.
export function calculateAirdropAmountInLIKE(
  amountUSD: BigNumber.Value,
  likePrice: number,
  ratio: number,
): number {
  if (!likePrice || likePrice <= 0 || !ratio || ratio <= 0) return 0;
  const base = new BigNumber(amountUSD);
  if (base.isNaN() || base.lte(0)) return 0;
  return base
    .multipliedBy(ratio)
    .dividedBy(likePrice)
    .integerValue(BigNumber.ROUND_FLOOR)
    .toNumber();
}

type LIKETransfer = Awaited<ReturnType<typeof transferLIKE>>;

// Shared by the done and failed records, so a broadcast is always kept the same way.
function getBroadcastFields({ txHash, rawSignedTx, nonce }: LIKETransfer) {
  return { airdropTxHash: txHash || '', airdropRawTx: rawSignedTx, airdropNonce: nonce };
}

// `claimSlot` takes the once-only gate for `ref`, where the outcome is then recorded.
// Never throws: an airdrop failure must not fail an already-paid order.
export async function payLIKEAirdrop({
  ref,
  claimSlot,
  wallet,
  amountUSD,
  ratio,
  logType,
  logPayload = {},
}: {
  ref: admin.firestore.DocumentReference;
  claimSlot: () => Promise<boolean>;
  wallet?: string;
  amountUSD: number;
  ratio: number;
  logType: AirdropLogType;
  logPayload?: Record<string, unknown>;
}): Promise<string | null> {
  let hasSlot = false;
  let broadcast: LIKETransfer | undefined;
  try {
    if (!wallet || !isValidEVMAddress(wallet)) return null;
    if (!amountUSD || amountUSD <= 0 || !ratio || ratio <= 0) return null;

    // The transfer simulation would catch a short balance anyway; reading it here
    // only buys a distinguishable low-treasury alert, so it rides along with the
    // price fetch rather than adding a round trip.
    const [likePrice, balance] = await Promise.all([
      getLIKEPrice(),
      getAPIWalletLIKEBalance(),
    ]);
    const amountInLIKE = calculateAirdropAmountInLIKE(amountUSD, likePrice, ratio);
    if (amountInLIKE <= 0) return null;

    const amount = LIKEToTokenAmount(amountInLIKE);
    // Checked before the slot is taken, so refilling the wallet leaves the payout
    // due instead of permanently marked.
    if (balance < amount) {
      // eslint-disable-next-line no-console
      console.error(
        `API wallet has insufficient LIKE balance for ${logType}. `
        + `Required: ${amount.toString()}, balance: ${balance.toString()}, ref: ${ref.path}`,
      );
      await publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: `${logType}InsufficientBalance`,
        ...logPayload,
        wallet,
        amountInLIKE,
        requiredAmount: amount.toString(),
        balance: balance.toString(),
      });
      return null;
    }

    hasSlot = await claimSlot();
    if (!hasSlot) return null;

    broadcast = await transferLIKE(wallet as `0x${string}`, amount);
    const { txHash } = broadcast;
    // The raw tx is kept so a broadcast that never mines can be re-sent; a gap at
    // this nonce stalls every later tx from the same wallet, mints included.
    await ref.update({
      airdropStatus: 'done',
      airdropLIKE: amountInLIKE,
      airdropWallet: wallet,
      ...getBroadcastFields(broadcast),
    });

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType,
      ...logPayload,
      wallet,
      amountInLIKE,
      ratio,
      likePrice,
      amountUSD,
      txHash,
    });
    return txHash;
  } catch (error) {
    // A failure before the gate attempted no payout, so it must leave no marker.
    // Once taken, 'failed' is terminal: the throw may have come after broadcast,
    // so an automatic second payout could double-pay.
    if (hasSlot) {
      // Keep the broadcast, if any, so a payout that may be on chain can be reconciled.
      await ref.update({
        airdropStatus: 'failed',
        airdropError: (error as Error).message || (error as Error).toString(),
        ...(broadcast && getBroadcastFields(broadcast)),
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to mark airdrop as failed', err);
      });
    }
    // eslint-disable-next-line no-console
    console.error(`Failed to pay ${logType} for ${ref.path}:`, error);
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: `${logType}Error`,
      ...logPayload,
      wallet,
      error: (error as Error).toString(),
    });
    return null;
  }
}

export default payLIKEAirdrop;
