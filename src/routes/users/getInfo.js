import { Router } from 'express';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { jwtAuth } from '../../middleware/jwt';
import {
  filterUserData,
} from '../../util/ValidationHelper';
import {
  getIntercomUserHash,
  getUserWithCivicLikerProperties,
} from '../../util/api/users';

const router = Router();

router.get('/self', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.user.user;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      payload.intercomToken = getIntercomUserHash(username);

      res.json(filterUserData(payload));
      await dbRef.doc(req.user.user).collection('session').doc(req.user.jti).update({
        lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
        lastAccessedIP: req.headers['x-real-ip'] || req.ip,
        lastAccessedTs: Date.now(),
      });
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.get('/id/:id', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.params.id;
    if (req.user.user !== username) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      res.json(filterUserData(payload));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
