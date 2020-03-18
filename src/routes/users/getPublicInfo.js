import { Router } from 'express';
import {
  AVATAR_DEFAULT_PATH,
} from '../../constant';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import {
  checkAddressValid,
  filterUserDataMin,
} from '../../util/ValidationHelper';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users/getPublicInfo';

const router = Router();

router.get('/id/:id/min', async (req, res, next) => {
  try {
    const username = req.params.id;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      res.set('Cache-Control', 'public, max-age=30');
      res.json(filterUserDataMin(payload));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.get('/merchant/:id/min', async (req, res, next) => {
  try {
    const merchantId = req.params.id;
    const query = await dbRef.where('merchantId', '==', merchantId).get();
    if (query.docs.length > 0) {
      const payload = query.docs[0].data();
      if (!payload.avatar) {
        payload.avatar = AVATAR_DEFAULT_PATH;
      }
      payload.user = query.docs[0].id;
      res.json(filterUserDataMin(payload));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.get('/addr/:addr/min', async (req, res, next) => {
  try {
    const { addr } = req.params;
    if (!checkAddressValid(addr)) throw new ValidationError('Invalid address');
    const query = await dbRef.where('wallet', '==', addr).get();
    if (query.docs.length > 0) {
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
