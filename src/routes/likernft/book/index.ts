import { Router } from 'express';

import purchase from './purchase';
import sponsorship from './sponsorship';
import store from './store';
import suggest from './suggest';
import user from './user';

const router = Router();

router.use('/purchase', purchase);
router.use('/sponsorship', sponsorship);
router.use('/store', store);
router.use('/metadata', suggest);
router.use('/user', user);

export default router;
