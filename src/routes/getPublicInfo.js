import { Router } from 'express';

import misc from './misc/totalSupply';
import social from './social/getPublicInfo';
import tx from './tx';
import users from './users/getPublicInfo';
import oembed from './oembed';


const router = Router();

router.use('/misc', misc);
router.use('/social', social);
router.use('/tx', tx);
router.use('/users', users);
router.use('/oembed', oembed);

export default router;
