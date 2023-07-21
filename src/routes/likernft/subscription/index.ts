import { Router } from 'express';
import creators from './creators';
import stripe from './stripe';

const router = Router();

router.use('/subscription/creators', creators);
router.use('/subscription/stripe', stripe);

export default router;
