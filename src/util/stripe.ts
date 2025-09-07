import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';
import { STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS } from '../constant';

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2025-02-24.acacia', typescript: true });

export function calculateStripeFee(inputAmount: number) {
  if (inputAmount === 0) return 0;
  // 2.9% + 30 cents, 1.5% for international cards
  const flatFee = 30;
  return Math.ceil(inputAmount * (0.029 + 0.015) + flatFee);
}

export async function getStripePromotionFromCode(code: string) {
  const promotionCode = await stripe.promotionCodes.list({
    limit: 1,
    active: true,
    code,
  });
  if (promotionCode.data.length === 0) {
    return null;
  }
  return promotionCode.data[0];
}

export async function getStripePromotoionCodesFromCheckoutSession(sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['total_details.breakdown.discounts.discount'],
  });
  const promotionCodeIds = session.total_details?.breakdown?.discounts
    .map((d) => (d.discount.promotion_code as string)) || [];
  const promotionCodeObjects = await Promise.all(promotionCodeIds
    .filter((id) => !!id)
    .map((id) => stripe.promotionCodes.retrieve(id)));
  const promotionCodes = promotionCodeObjects
    .map((p) => p.code)
    .filter((p) => !!p);
  return promotionCodes;
}

export async function getStripeFeeFromCheckoutSession(session: Stripe.Checkout.Session) {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent) {
    return 0;
  }
  const expandedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent as string, {
    expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  });
  const balanceTx = (expandedPaymentIntent.latest_charge as Stripe.Charge)
    ?.balance_transaction as Stripe.BalanceTransaction;
  const stripeFee = balanceTx.fee_details.find((fee) => fee.type === 'stripe_fee');
  return stripeFee?.amount || 0;
}

export default stripe;
