import { Router } from 'express';
import creators from './creators';

const router = Router();

router.use('/subscription/creators', creators);

export default router;
