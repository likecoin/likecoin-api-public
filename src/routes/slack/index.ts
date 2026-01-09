import { Router } from 'express';
import book from './book';
import nftIndexer from './nft-indexer';
import payment from './payment';
import plus from './plus';
import user from './user';
import wallet from './wallet';

const router = Router();

router.use(book);
router.use(nftIndexer);
router.use(payment);
router.use(plus);
router.use(user);
router.use(wallet);

export default router;
