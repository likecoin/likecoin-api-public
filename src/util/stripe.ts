import Stripe from 'stripe';
import { STRIPE_KEY } from '../../config/config';

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20', typescript: true });

export default stripe;
