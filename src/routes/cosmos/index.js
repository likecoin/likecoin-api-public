import { Router } from 'express';
import lcd from './lcd';

const router = Router();
router.use('/lcd', lcd);

export default router;
