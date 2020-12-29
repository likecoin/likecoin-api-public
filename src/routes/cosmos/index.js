import { Router } from 'express';
import lcd from './lcd';
import iscnDev from './iscn-dev/lcd';

const router = Router();
router.use('/lcd', lcd);
router.use('/iscn-dev/lcd', iscnDev);

export default router;
