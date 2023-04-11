import { Router } from 'express';
import status from './status';
import stripe from './stripe';
import mint from './mint';

const router = Router();

router.use('/subscription/status', status);
router.use('/subscription/stripe', stripe);
router.use('/subscription/mint', mint);

export default router;
