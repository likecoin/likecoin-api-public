import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';
import { STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS } from '../constant';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(STRIPE_KEY, { apiVersion: '2026-01-28.clover', typescript: true });
  }
  return stripeClient;
}

export function calculateStripeFee(inputAmount: number, currency = 'usd'): number {
  if (inputAmount === 0) return 0;
  // 2.9% + 30 cents, 1.5% for international cards
  const flatFee = 30;
  // 1% for currency conversion
  const fxFee = currency !== 'usd' ? 0.01 : 0;
  return Math.ceil(inputAmount * (0.029 + 0.015 + fxFee) + flatFee);
}

export async function getStripePromotionFromCode(code: string) {
  const stripe = getStripeClient();
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
  const stripe = getStripeClient();
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
  const stripe = getStripeClient();
  const paymentIntent = session.payment_intent;
  if (!paymentIntent) {
    return 0;
  }
  const expandedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent as string, {
    expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  });
  const balanceTx = (expandedPaymentIntent.latest_charge as Stripe.Charge)
    ?.balance_transaction as Stripe.BalanceTransaction;
  // balanceTx can be null when capture is automatic_async
  if (!balanceTx) {
    // eslint-disable-next-line no-console
    console.warn(`No balance transaction found for payment intent ${paymentIntent}`);
    return 0;
  }
  if (balanceTx.currency !== 'usd') {
    // eslint-disable-next-line no-console
    console.warn(`Balance transaction currency is not USD for payment intent ${paymentIntent}`);
  }
  const stripeFees = balanceTx.fee_details.filter((fee) => fee.type === 'stripe_fee' && fee.currency === balanceTx.currency);
  const stripeFee = stripeFees.reduce((prev, curr) => prev + curr.amount, 0);
  return stripeFee;
}

export function normalizeLanguageForStripeLocale(
  language: string | undefined,
): Stripe.Checkout.SessionCreateParams.Locale {
  switch (language) {
    case 'zh':
    case 'zh-Hant':
      return 'zh-TW';
    case 'en':
    case 'zh-HK':
    case 'zh-TW':
      return language;
    default:
      // Let Stripe detect language
      return 'auto';
  }
}
