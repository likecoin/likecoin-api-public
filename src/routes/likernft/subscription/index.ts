import { Router } from 'express';
import creators from './creators';
import readers from './readers';
import stripe from './stripe';

const router = Router();

router.use('/subscription/creators', creators);
router.use('/subscription/readers', readers);
router.use('/subscription/stripe', stripe);

export default router;
