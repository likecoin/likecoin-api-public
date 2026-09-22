import { BigNumber } from 'bignumber.js';
import { PUBSUB_TOPIC_MISC } from '../../../../constant';
import {
  admin, db, FieldValue, likeNFTBookCartCollection,
} from '../../../firebase';
import publisher from '../../../gcloudPub';
import { isValidEVMAddress } from '../../../evm';
import {
  LIKEToTokenAmount,
  getAPIWalletLIKEBalance,
  transferLIKE,
} from '../../../evm/likeCoin';
import { getLIKEPrice } from '../likePrice';
import type { TransactionFeeInfo } from './type';
import config from '../../../../../config/config';

export function getBookAirdropRatio(): number {
  // Repeated here rather than relying on config/config.js alone: the deployed
  // config shadows the repo one, so the key is undefined until it is added there.
  const ratio = config.BOOK_PURCHASE_AIRDROP_RATIO;
  return typeof ratio === 'number' ? ratio : 0.01;
}

// Whole LIKE only, since the buyer-facing number is never a fraction.
// Floors rather than rounds, so a payout never exceeds the ratio promised.
export function calculateBookAirdropAmountInLIKE(
  priceInDecimal: number,
  customPriceDiffInDecimal: number,
  likePrice: number,
  ratio: number = getBookAirdropRatio(),
): number {
  if (!likePrice || likePrice <= 0 || !ratio || ratio <= 0) return 0;
  // Tips are excluded, matching the LikeCollective reward base.
  const netInCents = new BigNumber(priceInDecimal).minus(customPriceDiffInDecimal);
  if (netInCents.isNaN() || netInCents.lte(0)) return 0;
  return netInCents
    .dividedBy(100)
    .multipliedBy(ratio)
    .dividedBy(likePrice)
    .integerValue(BigNumber.ROUND_FLOOR)
    .toNumber();
}

// Take the once-only slot for this cart. Returns false when another webhook
// delivery (or the same one retried) already holds it.
async function claimAirdropSlot(cartId: string): Promise<boolean> {
  const cartRef = likeNFTBookCartCollection.doc(cartId);
  return db.runTransaction(async (t: admin.firestore.Transaction) => {
    const doc = await t.get(cartRef);
    if (!doc.exists || doc.data()?.airdropStatus) return false;
    t.update(cartRef, {
      airdropStatus: 'processing',
      airdropStartedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/**
 * Pay the buyer their LIKE airdrop for a completed book cart.
 * Never throws: an airdrop failure must not fail an already-paid order.
 */
export async function payBookPurchaseAirdrop({
  cartId,
  wallet,
  feeInfo,
  email,
}: {
  cartId: string;
  wallet?: string;
  feeInfo: TransactionFeeInfo;
  email?: string | null;
}): Promise<string | null> {
  const cartRef = likeNFTBookCartCollection.doc(cartId);
  let hasSlot = false;
  try {
    if (!wallet || !isValidEVMAddress(wallet)) return null;
    const { priceInDecimal, customPriceDiffInDecimal = 0 } = feeInfo || ({} as TransactionFeeInfo);
    // Free carts are the majority of purchases; bail before any price lookup or write.
    if (!priceInDecimal || priceInDecimal <= customPriceDiffInDecimal) return null;

    // The transfer simulation would catch a short balance anyway; reading it here
    // only buys a distinguishable low-treasury alert, so it rides along with the
    // price fetch rather than adding a round trip.
    const [likePrice, balance] = await Promise.all([
      getLIKEPrice(),
      getAPIWalletLIKEBalance(),
    ]);
    const ratio = getBookAirdropRatio();
    const amountInLIKE = calculateBookAirdropAmountInLIKE(
      priceInDecimal,
      customPriceDiffInDecimal,
      likePrice,
      ratio,
    );
    if (amountInLIKE <= 0) return null;

    const amount = LIKEToTokenAmount(amountInLIKE);
    // Checked before the slot is taken, so refilling the wallet leaves the cart
    // payable instead of permanently marked.
    if (balance < amount) {
      // eslint-disable-next-line no-console
      console.error(
        'API wallet has insufficient LIKE balance for purchase airdrop. '
        + `Required: ${amount.toString()}, balance: ${balance.toString()}, cartId: ${cartId}`,
      );
      await publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'BookPurchaseAirdropInsufficientBalance',
        cartId,
        wallet,
        amountInLIKE,
        requiredAmount: amount.toString(),
        balance: balance.toString(),
      });
      return null;
    }

    hasSlot = await claimAirdropSlot(cartId);
    if (!hasSlot) return null;

    const { txHash, rawSignedTx, nonce } = await transferLIKE(wallet as `0x${string}`, amount);
    // The raw tx is kept so a broadcast that never mines can be re-sent; a gap at
    // this nonce stalls every later tx from the same wallet, mints included.
    await cartRef.update({
      airdropStatus: 'done',
      airdropLIKE: amountInLIKE,
      airdropWallet: wallet,
      airdropTxHash: txHash || '',
      airdropRawTx: rawSignedTx,
      airdropNonce: nonce,
    });

    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'BookPurchaseAirdrop',
      cartId,
      wallet,
      email,
      amountInLIKE,
      ratio,
      likePrice,
      priceInUSD: (priceInDecimal - customPriceDiffInDecimal) / 100,
      amountUSD: (priceInDecimal - customPriceDiffInDecimal) / 100,
      txHash,
    });
    return txHash;
  } catch (error) {
    // A failure before the gate attempted no payout, so it must leave no marker.
    // Once taken, 'failed' is terminal: the throw may have come after broadcast,
    // so an automatic second payout could double-pay.
    if (hasSlot) {
      await cartRef.update({
        airdropStatus: 'failed',
        airdropError: (error as Error).message || (error as Error).toString(),
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to mark airdrop as failed', err);
      });
    }
    // eslint-disable-next-line no-console
    console.error(`Failed to pay purchase airdrop for cart ${cartId}:`, error);
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'BookPurchaseAirdropError',
      cartId,
      wallet,
      error: (error as Error).toString(),
    });
    return null;
  }
}

export default payBookPurchaseAirdrop;
