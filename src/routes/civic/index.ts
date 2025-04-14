import { Router } from 'express';
import staking from './staking';

const router = Router();

router.use(staking);

export default router;
