import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export default Stripe(STRIPE_KEY);
