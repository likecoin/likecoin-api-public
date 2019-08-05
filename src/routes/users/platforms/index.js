import { Router } from 'express';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  admin,
} from '../../../util/firebase';
import {
  checkSignPayload,
  tryToLinkOAuthLogin,
  tryToUnlinkOAuthLogin,
} from '../../../util/api/users';
import { tryToLinkSocialPlatform } from '../../../util/api/social';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth } from '../../../middleware/jwt';
import { getFirebaseUserProviderUserInfo } from '../../../util/FirebaseApp';
import publisher from '../../../util/gcloudPub';

const router = Router();

router.get('/login/platforms', jwtAuth('read'), async (req, res, next) => {
  try {
    if (!req.user.user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const authDoc = await authDbRef.doc(req.user.user).get();
    const platforms = {};
    if (authDoc.exists) {
      Object.keys(authDoc.data())
        .forEach((pid) => { platforms[pid] = true; });
    }
    res.json(platforms);
  } catch (err) {
    next(err);
  }
});

router.post('/login/:platform/add', jwtAuth('write'), async (req, res, next) => {
  try {
    const { user } = req.body;
    const { platform } = req.params;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    let platformUserId;
    switch (platform) {
      case 'wallet': {
        const {
          from,
          payload: stringPayload,
          sign,
        } = req.body;
        const wallet = from;
        checkSignPayload(wallet, stringPayload, sign);
        const query = await dbRef.where('wallet', '==', wallet).get();
        if (query.docs.length > 0) throw new ValidationError('WALLET_ALREADY_USED');
        await dbRef.doc(user).update({ wallet });
        break;
      }

      case 'google':
      case 'twitter':
      case 'facebook': {
        const {
          firebaseIdToken,
          accessToken,
          secret,
        } = req.body;
        const { uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken);
        const firebaseUser = await admin.auth().getUser(firebaseUserId);
        const query = await dbRef.where('firebaseUserId', '==', firebaseUserId).get();
        if (query.docs.length > 0) {
          query.forEach((doc) => {
            const docUser = doc.id;
            if (user !== docUser) {
              throw new ValidationError('FIREBASE_USER_DUPLICATED');
            }
          });
        } else {
          await dbRef.doc(user).update({ firebaseUserId });
        }
        const userInfo = getFirebaseUserProviderUserInfo(firebaseUser, platform);
        if (!userInfo || !userInfo.uid) throw new ValidationError('CANNOT_FETCH_USER_INFO');
        platformUserId = userInfo.uid;
        await tryToLinkOAuthLogin({ likeCoinId: user, platform, platformUserId });

        if (platform === 'twitter' || platform === 'facebook') {
          await tryToLinkSocialPlatform(user, platform, { accessToken, secret });
        }

        break;
      }

      default:
        throw new ValidationError('INVALID_PLATFORM');
    }

    res.sendStatus(200);
    const doc = await dbRef.doc(user).get();
    if (doc.exists) {
      const {
        wallet,
        email,
        displayName,
        referrer,
        locale,
        timestamp: registerTime,
      } = doc.data();
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventSocialLink',
        platform,
        user,
        email,
        displayName,
        wallet,
        referrer,
        locale,
        registerTime,
        platformUserId,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/login/:platform', jwtAuth('write'), async (req, res, next) => {
  try {
    const { platform } = req.params;
    if (!req.user.user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    if (await tryToUnlinkOAuthLogin({
      likeCoinId: req.user.user,
      platform,
    })) {
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
