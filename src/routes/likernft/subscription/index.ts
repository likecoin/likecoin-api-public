import { Router } from 'express';
import stripe from './stripe';

const router = Router();

router.use('/subscription/stripe', stripe);

export default router;
