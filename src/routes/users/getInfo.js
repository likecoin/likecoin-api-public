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
  getCrispUserHash,
  getUserWithCivicLikerProperties,
  getUserAgentPlatform,
  getUserAgentIsApp,
} from '../../util/api/users';
import { lazyUpdateAppMetaData } from '../../util/api/users/app';

const router = Router();

router.get('/self', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.user.user;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      if (payload.isBlackListed) throw new Error('INVALID_USER');
      payload.intercomToken = getIntercomUserHash(username, { type: getUserAgentPlatform(req) });
      if (payload.email) payload.crispToken = getCrispUserHash(payload.email);
      res.json(filterUserData(payload));
      await dbRef.doc(username).collection('session').doc(req.user.jti).set({
        lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
        lastAccessedIP: req.headers['x-real-ip'] || req.ip,
        lastAccessedTs: Date.now(),
      }, { merge: true });
      if (getUserAgentIsApp(req)) {
        const user = {
          user: username,
          ...payload,
        };
        lazyUpdateAppMetaData(req, user);
      }
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
