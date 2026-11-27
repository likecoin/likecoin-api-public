import { Router } from 'express';
import book from './book';
import interactive from './interactive';
import nftIndexer from './nft-indexer';
import payment from './payment';
import plus from './plus';
import user from './user';
import wallet from './wallet';

const router = Router();

router.use(book);
router.use(interactive);
router.use(nftIndexer);
router.use(payment);
router.use(plus);
router.use(user);
router.use(wallet);

export default router;
