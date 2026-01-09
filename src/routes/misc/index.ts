import { Router } from 'express';
import price from './price';
import totalSupply from './totalSupply';

const router = Router();

router.use(price);
router.use(totalSupply);

export default router;
