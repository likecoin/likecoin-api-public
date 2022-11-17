import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';

// @ts-ignore
export default Stripe(STRIPE_KEY);
