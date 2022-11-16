import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';

export default Stripe(STRIPE_KEY);
