import { BigNumber } from 'bignumber.js';
import {
  admin, db, FieldValue, likeNFTBookCartCollection,
} from '../../../firebase';
import { calculateAirdropAmountInLIKE, getAirdropRatio, payLIKEAirdrop } from '../../../airdrop';
import type { TransactionFeeInfo } from './type';
import config from '../../../../../config/config';

export function getBookAirdropRatio(): number {
  return getAirdropRatio(config.BOOK_PURCHASE_AIRDROP_RATIO);
}

// Tips are excluded, matching the LikeCollective reward base.
function getNetPriceInUSD(priceInDecimal: number, customPriceDiffInDecimal: number) {
  return new BigNumber(priceInDecimal).minus(customPriceDiffInDecimal).dividedBy(100);
}

export function calculateBookAirdropAmountInLIKE(
  priceInDecimal: number,
  customPriceDiffInDecimal: number,
  likePrice: number,
  ratio: number = getBookAirdropRatio(),
): number {
  return calculateAirdropAmountInLIKE(
    getNetPriceInUSD(priceInDecimal, customPriceDiffInDecimal),
    likePrice,
    ratio,
  );
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
  const { priceInDecimal, customPriceDiffInDecimal = 0 } = feeInfo || ({} as TransactionFeeInfo);
  // Free carts are the majority of purchases; bail before any price lookup or write.
  if (!priceInDecimal || priceInDecimal <= customPriceDiffInDecimal) return null;
  const amountUSD = getNetPriceInUSD(priceInDecimal, customPriceDiffInDecimal).toNumber();
  return payLIKEAirdrop({
    ref: likeNFTBookCartCollection.doc(cartId),
    claimSlot: () => claimAirdropSlot(cartId),
    wallet,
    amountUSD,
    ratio: getBookAirdropRatio(),
    logType: 'BookPurchaseAirdrop',
    // priceInUSD predates amountUSD in the archived BookPurchaseAirdrop events.
    logPayload: { cartId, email, priceInUSD: amountUSD },
  });
}

export default payBookPurchaseAirdrop;
