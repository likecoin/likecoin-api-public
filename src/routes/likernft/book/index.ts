import { Router } from 'express';

import purchase from './purchase';
import store from './store';
import user from './user';

const router = Router();

router.use('/purchase', purchase);
router.use('/store', store);
router.use('/user', user);

export default router;
