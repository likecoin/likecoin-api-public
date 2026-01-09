import { Router } from 'express';
import apiGetInfo from './apiGetInfo';
import apiRegister from './apiRegister';
import bookmarks from './bookmarks';
import deleteRoute from './delete';
import follow from './follow';
import getInfo from './getInfo';
import getPublicInfo from './getPublicInfo';
import hook from './hook';
import notifications from './notifications';
import preferences from './preferences';
import registerLogin from './registerLogin';
import setInfo from './setInfo';

const router = Router();

router.use(apiGetInfo);
router.use(apiRegister);
router.use(bookmarks);
router.use(deleteRoute);
router.use(follow);
router.use(getInfo);
router.use(getPublicInfo);
router.use(hook);
router.use(notifications);
router.use(preferences);
router.use(registerLogin);
router.use(setInfo);

export default router;
