import { Router } from 'express';

import purchase from './purchase';
import store from './store';
import user from '../connect';

const router = Router();

router.use('/book/purchase', purchase);
router.use('/book/store', store);
router.use('/book/user', user);

export default router;
