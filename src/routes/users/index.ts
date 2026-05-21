import { Router } from 'express';
import apiGetInfo from './apiGetInfo';
import apiRegister from './apiRegister';
import deleteRoute from './delete';
import getInfo from './getInfo';
import getPublicInfo from './getPublicInfo';
import preferences from './preferences';
import registerLogin from './registerLogin';

const router = Router();

router.use(apiGetInfo);
router.use(apiRegister);
router.use(deleteRoute);
router.use(getInfo);
router.use(getPublicInfo);
router.use(preferences);
router.use(registerLogin);

export default router;
