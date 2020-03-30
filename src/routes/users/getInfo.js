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
} from '../../util/api/users';

const router = Router();

function fetchUserAgentPlatform(req) {
  const { 'user-agent': userAgent = '' } = req.headers;
  if (userAgent.includes('LikeCoinApp')) {
    if (userAgent.includes('Android')) return 'android';
    if (userAgent.includes('iOS')) return 'ios';
  }
  return 'web';
}

router.get('/self', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.user.user;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      payload.intercomToken = getIntercomUserHash(username, { type: fetchUserAgentPlatform(req) });
      if (payload.email) payload.crispToken = getCrispUserHash(payload.email);
      res.json(filterUserData(payload));
      await dbRef.doc(username).collection('session').doc(req.user.jti).set({
        lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
        lastAccessedIP: req.headers['x-real-ip'] || req.ip,
        lastAccessedTs: Date.now(),
      }, { merge: true });
      const agentType = fetchUserAgentPlatform(req);
      if (agentType !== 'web') {
        const appMetaDocRef = dbRef.doc(username).collection('app').doc('!meta');
        try {
          await appMetaDocRef.update({
            [agentType]: true,
            lastAccessedTs: Date.now(),
          });
        } catch (err) {
          await appMetaDocRef.create({
            [agentType]: true,
            lastAccessedTs: Date.now(),
            ts: Date.now(),
          });
        }
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
