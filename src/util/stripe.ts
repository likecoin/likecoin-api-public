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

export default stripe;
