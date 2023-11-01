import { Router } from 'express';

import payment from './payment';
import purchase from './purchase';
import store from './store';
import user from './user';

const router = Router();

router.use('/book/payment', payment);
router.use('/book/purchase', purchase);
router.use('/book/store', store);
router.use('/book/user', user);

export default router;
