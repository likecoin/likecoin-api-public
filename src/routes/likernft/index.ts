import { Router } from 'express';
import book from './book';
import fiat from './fiat';
import metadata from './metadata';
import mint from './mint';

const router = Router();

router.use('/book', book);
router.use('/fiat', fiat);
router.use(metadata);
router.use(mint);

export default router;
