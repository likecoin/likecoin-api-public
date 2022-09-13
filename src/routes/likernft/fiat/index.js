import { Router } from 'express';
import stripe from './stripe';

const router = Router();

router.use('/fiat/stripe', stripe);

export default router;
