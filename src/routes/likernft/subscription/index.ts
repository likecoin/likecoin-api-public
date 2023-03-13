import { Router } from 'express';
import stripe from './stripe';
import mint from './mint';

const router = Router();

router.use('/subscription/stripe', stripe);
router.use('/subscription/mint', mint);

export default router;
