import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20', typescript: true });

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

export default stripe;
