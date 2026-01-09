import { Router } from 'express';
import nft from './nft';

const router = Router();

router.use('/nft', nft);

export default router;
