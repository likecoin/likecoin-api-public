import { Router } from 'express';

import purchase from './purchase';
import store from './store';

const router = Router();

router.use('/book/purchase', purchase);
router.use('/book/store', store);

export default router;
