import { FieldValue, userCollection } from '../../firebase';
import { getAirdropRatio, payLIKEAirdrop } from '../../airdrop';
import { isAlreadyExistsError } from '../../misc';
import config from '../../../../config/config';

export function getPlusAirdropRatio(): number {
  return getAirdropRatio(config.PLUS_SUBSCRIPTION_AIRDROP_RATIO);
}

// Gated on its own doc, not processedStripeInvoices: that claim is released when
// analytics fail and expires by TTL, either of which would let a payout repeat.
export async function payPlusSubscriptionAirdrop({
  likerId,
  invoiceId,
  subscriptionId,
  wallet,
  amountPaidUSD,
  billingReason,
}: {
  likerId: string;
  invoiceId: string;
  subscriptionId: string;
  wallet?: string;
  amountPaidUSD: number;
  billingReason?: string | null;
}): Promise<string | null> {
  // Trials and fully discounted invoices; bail before any price lookup or write.
  if (!amountPaidUSD || amountPaidUSD <= 0) return null;
  const ref = userCollection.doc(likerId).collection('plusAirdrops').doc(invoiceId);
  return payLIKEAirdrop({
    ref,
    claimSlot: async () => {
      try {
        await ref.create({
          invoiceId,
          subscriptionId,
          airdropStatus: 'processing',
          airdropStartedAt: FieldValue.serverTimestamp(),
        });
        return true;
      } catch (err) {
        if (isAlreadyExistsError(err)) return false;
        throw err;
      }
    },
    wallet,
    amountUSD: amountPaidUSD,
    ratio: getPlusAirdropRatio(),
    logType: 'PlusSubscriptionAirdrop',
    logPayload: {
      likerId, invoiceId, subscriptionId, billingReason,
    },
  });
}

export default payPlusSubscriptionAirdrop;
