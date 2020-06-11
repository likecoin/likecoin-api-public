import { Router } from 'express';

import miscTotalSupply from './misc/totalSupply';
import miscPrice from './misc/price';
import social from './social/getPublicInfo';
import tx from './tx';
import users from './users/getPublicInfo';
import userBookmarks from './users/bookmarks';
import usersHook from './users/hook';
import oembed from './oembed';
import cosmos from './cosmos';


const router = Router();

router.use('/misc', miscTotalSupply);
router.use('/misc', miscPrice);
router.use('/social', social);
router.use('/tx', tx);
router.use('/users', users);
router.use('/users', userBookmarks);
router.use('/users/hook', usersHook);
router.use('/oembed', oembed);
router.use('/cosmos', cosmos);

export default router;
