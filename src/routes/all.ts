import { Router } from 'express';
import app from './app';
import arweave from './arweave';
import civic from './civic';
import cosmos from './cosmos';
import email from './email';
import likerland from './likerland';
import likernft from './likernft';
import misc from './misc';
import oembed from './oembed';
import plus from './plus';
import slack from './slack';
import tx from './tx';
import users from './users';
import wallet from './wallet';

const router = Router();

router.use('/app', app);
router.use('/arweave', arweave);
router.use('/civic', civic);
router.use('/cosmos', cosmos);
router.use('/email', email);
router.use('/likerland', likerland);
router.use('/likernft', likernft);
router.use('/misc', misc);
router.use('/oembed', oembed);
router.use('/plus', plus);
router.use('/slack', slack);
router.use('/tx', tx);
router.use('/users', users);
router.use('/wallet', wallet);

export default router;
