import { Router } from 'express';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../util/firebase';
import { jwtAuth } from '../../middleware/jwt';
import { validateParams } from '../../middleware/validate';
import { UsersIdParamsSchema, UserDataFilteredResponseSchema } from '../../util/api/users/schemas';
import {
  filterUserData,
  sendValidatedJSON,
} from '../../util/ValidationHelper';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users';

const router = Router();

router.get('/self', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.user.user;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      if (payload.isDeleted) {
        res.sendStatus(404);
        return;
      }
      if (payload.isLocked) {
        // eslint-disable-next-line no-console
        console.log(`Locked user: ${username}`);
        throw new Error('USER_LOCKED');
      }
      sendValidatedJSON(res, UserDataFilteredResponseSchema, filterUserData(payload));
      await dbRef.doc(username).collection('session').doc(req.user.jti).set({
        lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
        lastAccessedIP: req.headers['x-real-ip'] || req.ip,
        lastAccessedTimestamp: FieldValue.serverTimestamp(),
        lastAccessedTs: FieldValue.delete(),
      }, { merge: true });
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.get('/id/:id', jwtAuth('read'), validateParams(UsersIdParamsSchema), async (req, res, next) => {
  try {
    const username = req.params.id;
    if (req.user.user !== username) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const payload = await getUserWithCivicLikerProperties(username as string);
    if (payload) {
      if (payload.isDeleted) {
        res.sendStatus(404);
        return;
      }
      sendValidatedJSON(res, UserDataFilteredResponseSchema, filterUserData(payload));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
