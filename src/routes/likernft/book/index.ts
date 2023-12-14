import { Router } from 'express';

import purchase from './purchase';
import store from './store';
import user from './user';
import collection from './collection';

const router = Router();

router.use('/book/purchase', purchase);
router.use('/book/store', store);
router.use('/book/user', user);
router.use('/book/collection', collection);

export default router;
