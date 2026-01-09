import { Router } from 'express';
import history from './history';
import tx from './tx';

const router = Router();

router.use(history);
router.use(tx);

export default router;
