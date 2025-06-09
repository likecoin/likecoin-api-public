import type Stripe from 'stripe';

import { LIKER_PLUS_MONTHLY_PRICE_ID, LIKER_PLUS_YEARLY_PRICE_ID } from '../../../../config/config';
import { BOOK3_HOSTNAME } from '../../../constant';
import { getBookUserInfoFromWallet } from '../likernft/book/user';
import stripe from '../../stripe';

export function processStripeSubscription(session, req) {
  // TODO
}

export async function createNewPlusCheckoutSession(period: 'monthly' | 'yearly', req) {
  const { wallet } = req.user;
  let userEmail;
  let customerId;
  if (wallet) {
    const userInfo = await getBookUserInfoFromWallet(wallet);
    if (userInfo) {
      const { bookUserInfo, likerUserInfo } = userInfo;
      if (likerUserInfo) userEmail = likerUserInfo.email;
      if (bookUserInfo) customerId = bookUserInfo.stripeCustomerId;
    }
  }
  const payload: Stripe.Checkout.SessionCreateParams = {
    billing_address_collection: 'auto',
    line_items: [
      {
        price: period === 'yearly' ? LIKER_PLUS_YEARLY_PRICE_ID : LIKER_PLUS_MONTHLY_PRICE_ID,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `https://${BOOK3_HOSTNAME}/plus/success`,
    cancel_url: `https://${BOOK3_HOSTNAME}/plus`,
  };
  if (customerId) {
    payload.customer = customerId;
  } else {
    payload.customer_email = userEmail;
  }
  const session = await stripe.checkout.sessions.create(payload);
  return session;
}

export default processStripeSubscription;
