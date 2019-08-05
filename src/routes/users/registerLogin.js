import { Router } from 'express';
import bodyParser from 'body-parser';
import csrf from 'csurf';
import {
  PUBSUB_TOPIC_MISC,
  CSRF_COOKIE_OPTION,
} from '../../constant';
import { fetchMattersUser } from '../../util/oauth/matters';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  FieldValue,
  admin,
} from '../../util/firebase';
import {
  handleEmailBlackList,
  checkIsOldUser,
  checkSignPayload,
  setAuthCookies,
  checkEmailIsSoleLogin,
  clearAuthCookies,
} from '../../util/api/users';
import { handleUserRegistration } from '../../util/api/users/register';
import { ValidationError } from '../../util/ValidationError';
import { handleAvatarUploadAndGetURL } from '../../util/fileupload';
import { jwtAuth } from '../../middleware/jwt';
import publisher from '../../util/gcloudPub';
import { getFirebaseUserProviderUserInfo } from '../../util/FirebaseApp';
import {
  REGISTER_LIMIT_WINDOW,
  REGISTER_LIMIT_COUNT,
} from '../../../config/config';

import loginPlatforms from './platforms';

const Multer = require('multer');
const RateLimit = require('express-rate-limit');

export const THIRTY_S_IN_MS = 30000;

const multer = Multer({
  storage: Multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // no larger than 5mb, you can change as needed.
  },
});

const router = Router();

const apiLimiter = new RateLimit({
  windowMs: REGISTER_LIMIT_WINDOW,
  max: REGISTER_LIMIT_COUNT || 0,
  skipFailedRequests: true,
  keyGenerator: req => (req.headers['x-real-ip'] || req.ip),
  onLimitReached: (req) => {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventAPILimitReached',
    });
  },
});

router.use(loginPlatforms);

router.post(
  '/new',
  csrf({ cookie: CSRF_COOKIE_OPTION }),
  bodyParser.urlencoded({ extended: false }),
  apiLimiter,
  multer.single('avatarFile'),
  async (req, res, next) => {
    const {
      platform,
    } = req.body;
    let {
      user,
      email,
    } = req.body;
    try {
      let payload;
      let firebaseUserId;
      let platformUserId;
      let isEmailVerified = false;

      switch (platform) {
        case 'wallet': {
          const {
            from,
            payload: stringPayload,
            sign,
            referrer,
            sourceURL,
          } = req.body;
          payload = checkSignPayload(from, stringPayload, sign);
          ({ user, email } = payload);
          payload.referrer = referrer;
          payload.sourceURL = sourceURL;
          break;
        }
        case 'google':
        case 'twitter':
        case 'facebook': {
          const { firebaseIdToken } = req.body;
          ({ uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken));
          payload = req.body;

          // Set verified to the email if it matches Firebase verified email
          const firebaseUser = await admin.auth().getUser(firebaseUserId);
          isEmailVerified = firebaseUser.email === payload.email && firebaseUser.emailVerified;

          switch (platform) {
            case 'google':
            case 'twitter':
            case 'facebook': {
              const userInfo = getFirebaseUserProviderUserInfo(firebaseUser, platform);
              if (userInfo) {
                platformUserId = userInfo.uid;
              }
              break;
            }
            default:
          }
          break;
        }
        case 'matters': {
          const { accessToken } = req.body;
          const { userId, email: mattersEmail } = await fetchMattersUser(accessToken);
          platformUserId = userId;
          payload = req.body;

          // Set verified to the email if it matches platform verified email
          isEmailVerified = mattersEmail === payload.email;
          break;
        }
        default:
          throw new ValidationError('INVALID_PLATFORM');
      }
      const {
        userPayload,
        socialPayload,
      } = await handleUserRegistration({
        payload: {
          platformUserId,
          isEmailVerified,
          ...payload,
        },
        res,
        req,
      });
      const { wallet } = userPayload;

      await setAuthCookies(req, res, { user, wallet });
      res.sendStatus(200);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        ...userPayload,
        logType: 'eventUserRegister',
      });
      if (socialPayload) {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          ...userPayload,
          ...socialPayload,
          logType: 'eventSocialLink',
        });
      }
    } catch (err) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventRegisterError',
        platform,
        user,
        email,
        error: err.message || JSON.stringify(err),
      });
      next(err);
    }
  },
);

router.post(
  '/update',
  csrf({ cookie: CSRF_COOKIE_OPTION }),
  bodyParser.urlencoded({ extended: false }),
  jwtAuth('write'),
  multer.single('avatarFile'),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      if (!user) {
        res.status(401).send('LOGIN_NEEDED');
        return;
      }

      const {
        displayName,
        avatarSHA256,
        locale,
      } = req.body;
      let { email, isEmailEnabled } = req.body;

      // handle isEmailEnable is string
      if (typeof isEmailEnabled === 'string') {
        isEmailEnabled = isEmailEnabled !== 'false';
      }

      const oldUserObj = await checkIsOldUser({ user, email });
      if (!oldUserObj) throw new ValidationError('USER_NOT_FOUND');

      const {
        wallet,
        referrer,
        displayName: oldDisplayName,
        locale: oldLocale,
      } = oldUserObj;

      if (email) {
        try {
          email = handleEmailBlackList(email);
        } catch (err) {
          if (err.message === 'DOMAIN_NOT_ALLOWED' || err.message === 'DOMAIN_NEED_EXTRA_CHECK') {
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventBlockEmail',
              user,
              email,
              displayName: oldDisplayName,
              wallet,
              referrer,
              locale: oldLocale,
            });
          }
          throw err;
        }
      }

      // update avatar
      const { file } = req;
      let avatarUrl;
      if (file) {
        avatarUrl = await handleAvatarUploadAndGetURL(user, file, avatarSHA256);
      }
      const updateObj = {
        displayName,
        isEmailEnabled,
        avatar: avatarUrl,
        locale,
      };
      const oldEmail = oldUserObj.email;
      if (email && email !== oldEmail) {
        if (await checkEmailIsSoleLogin(user)) {
          throw new ValidationError('USER_EMAIL_SOLE_LOGIN');
        }
        updateObj.email = email;
        updateObj.verificationUUID = FieldValue.delete();
        updateObj.isEmailVerified = false;
        updateObj.lastVerifyTs = FieldValue.delete();
      }

      Object.keys(updateObj).forEach((key) => {
        if (updateObj[key] === undefined) {
          delete updateObj[key];
        }
      });

      await dbRef.doc(user).update(updateObj);
      res.sendStatus(200);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventUserUpdate',
        user,
        email: email || oldEmail,
        displayName: displayName || oldDisplayName,
        wallet,
        avatar: avatarUrl || oldUserObj.avatar,
        referrer,
        locale: locale || oldLocale,
        registerTime: oldUserObj.timestamp,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/login', async (req, res, next) => {
  try {
    let user;
    let wallet;
    const { platform } = req.body;

    switch (platform) {
      case 'wallet': {
        const {
          from,
          payload: stringPayload,
          sign,
        } = req.body;
        wallet = from;
        checkSignPayload(wallet, stringPayload, sign);
        const query = await dbRef.where('wallet', '==', wallet).limit(1).get();
        if (query.docs.length > 0) {
          user = query.docs[0].id;
        }
        break;
      }
      case 'google':
      case 'twitter':
      case 'facebook': {
        const { firebaseIdToken } = req.body;
        const { uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken);
        if (firebaseUserId) {
          const userQuery = await (
            authDbRef
              .where('firebase.userId', '==', firebaseUserId)
              .get()
          );
          if (userQuery.docs.length > 0) {
            const [userDoc] = userQuery.docs;
            user = userDoc.id;
            if (!userDoc.data()[platform]) {
              /* update the missing platform ID */
              const firebaseUser = await admin.auth().getUser(firebaseUserId);
              const userInfo = getFirebaseUserProviderUserInfo(firebaseUser, platform);
              if (!userInfo) throw new ValidationError('INVALID_PLATFORM');
              await userDoc.ref.update({ [platform]: { userId: userInfo.uid } });
            }
          }
        }
        break;
      }
      case 'matters': {
        const { accessToken } = req.body;
        const { userId } = await fetchMattersUser(accessToken);
        const userQuery = await (
          authDbRef
            .where(`${platform}.userId`, '==', userId)
            .get()
        );
        if (userQuery.docs.length > 0) {
          const [userDoc] = userQuery.docs;
          user = userDoc.id;
        }
        break;
      }
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }

    if (user) {
      await setAuthCookies(req, res, { user, wallet });
      res.sendStatus(200);

      const doc = await dbRef.doc(user).get();
      if (doc.exists) {
        const {
          email,
          displayName,
          referrer,
          locale,
          timestamp: registerTime,
        } = doc.data();
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventUserLogin',
          user,
          email,
          displayName,
          wallet,
          referrer,
          locale,
          registerTime,
          platform,
        });
      }
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/logout', jwtAuth('read'), async (req, res, next) => {
  try {
    const { user, jti } = req.user;

    clearAuthCookies(req, res);
    res.sendStatus(200);

    if (user) {
      try {
        await dbRef.doc(user).collection('session').doc(jti).delete();
      } catch (err) {
        console.error(err);
      }
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
          logType: 'eventUserLogout',
          user,
          email,
          displayName,
          wallet,
          referrer,
          locale,
          registerTime,
        });
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
