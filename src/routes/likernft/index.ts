import { Router } from 'express';
import book from './book';
import fiat from './fiat';
import history from './history';
import list from './list';
import metadata from './metadata';
import mint from './mint';
import user from './user';

const router = Router();

router.use('/book', book);
router.use('/fiat', fiat);
router.use(history);
router.use(list);
router.use(metadata);
router.use(mint);
router.use(user);

export default router;
