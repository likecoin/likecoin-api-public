import { Router } from 'express';

import purchase from './purchase';
import store from './store';

const router = Router();

router.use('/purchase', purchase);
router.use('/store', store);

export default router;
