import { Router } from 'express';
import lcd from './lcd';
import signer from './signer';

const router = Router();
router.use('/lcd', lcd);
router.use('/signer', signer);

export default router;
