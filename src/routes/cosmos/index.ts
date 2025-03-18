import { Router } from 'express';
import lcd from './lcd';
import rpc from './rpc';

const router = Router();
router.use('/lcd', lcd);
router.use('/rpc', rpc);

export default router;
