import { Router } from 'express';
import lcd from './lcd';
import rpc from './rpc';
import iscnDev from './iscn-dev';

const router = Router();
router.use('/lcd', lcd);
router.use('/rpc', rpc);
router.use('/iscn-dev', iscnDev);

export default router;
