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
} from '../../util/firebase';
import {
  getAuthCoreUser,
  createAuthCoreCosmosWalletIfNotExist,
} from '../../util/authcore';
import {
  handleEmailBlackList,
  checkSignPayload,
  setAuthCookies,
  clearAuthCookies,
} from '../../util/api/users';
import { handleUserRegistration } from '../../util/api/users/register';
import { ValidationError } from '../../util/ValidationError';
import { handleAvatarUploadAndGetURL } from '../../util/fileupload';
import { jwtAuth } from '../../middleware/jwt';
import { authCoreJwtVerify, authCoreJwtSignToken } from '../../util/jwt';
import publisher from '../../util/gcloudPub';
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
      user,
    } = req.body;
    let email;
    try {
      let payload;
      let platformUserId;
      let isEmailVerified = false;

      switch (platform) {
        case 'authcore': {
          const { idToken, ...authCorePayload } = req.body;
          if (!idToken) throw new ValidationError('ID_TOKEN_MISSING');
          const authCoreUser = authCoreJwtVerify(idToken);
          const {
            sub: authCoreUserId,
            email: authCoreEmail,
            email_verified: isAuthCoreEmailVerified,
          } = authCoreUser;
          payload = authCorePayload;
          payload.authCoreUserId = authCoreUserId;
          if (!payload.cosmosWallet) {
            payload.cosmosWallet = await createAuthCoreCosmosWalletIfNotExist(
              authCoreUserId,
              authCoreJwtSignToken(),
            );
          }
          email = authCoreEmail;
          isEmailVerified = isAuthCoreEmailVerified;
          platformUserId = authCoreUserId;
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
          platform,
          platformUserId,
          isEmailVerified,
          ...payload,
        },
        res,
        req,
      });

      await setAuthCookies(req, res, { user, platform });
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
      const oldUserObj = await dbRef.doc(user).get();
      const {
        wallet,
        referrer,
        displayName: oldDisplayName,
        locale: oldLocale,
      } = oldUserObj.data();

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

router.post('/sync/authcore', jwtAuth('write'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const {
      authCoreAccessToken,
    } = req.body;
    const {
      email,
      displayName,
      isEmailVerified,
    } = await getAuthCoreUser(authCoreAccessToken);

    await dbRef.doc(user).update({
      email,
      displayName,
      isEmailVerified,
    });
    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventUserSync',
      type: 'authcore',
      user,
      email,
      displayName,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    let user;
    let wallet;
    const { platform } = req.body;

    switch (platform) {
      case 'wallet': {
        /* for migration only */
        const {
          from,
          payload: stringPayload,
          sign,
        } = req.body;
        wallet = from;
        checkSignPayload(wallet, stringPayload, sign);
        const query = await dbRef.where('wallet', '==', wallet).limit(1).get();
        if (query.docs.length > 0) {
          const [userDoc] = query.docs;
          user = userDoc.id;
          if (userDoc.data().authCoreUserId) {
            throw new ValidationError('USE_AUTHCORE_LOGIN');
          }
        }
        break;
      }
      case 'authcore': {
        const { idToken } = req.body;
        if (!idToken) throw new ValidationError('ID_TOKEN_MISSING');
        const authCoreUser = authCoreJwtVerify(idToken);
        const { sub: authCoreId } = authCoreUser;
        const userQuery = await (
          authDbRef
            .where(`${platform}.userId`, '==', authCoreId)
            .get()
        );
        if (userQuery.docs.length > 0) {
          const [userDoc] = userQuery.docs;
          user = userDoc.id;
        }
        break;
      }
      case 'matters': {
        /* TODO: remove after authcore support confirm */
        const { accessToken } = req.body;
        const { userId } = await fetchMattersUser({ accessToken });
        const userQuery = await (
          authDbRef
            .where(`${platform}.userId`, '==', userId)
            .get()
        );
        if (userQuery.docs.length > 0) {
          const [userDoc] = userQuery.docs;
          user = userDoc.id;
          if (userDoc.data().authCoreUserId) {
            throw new ValidationError('USE_AUTHCORE_LOGIN');
          }
        }
        break;
      }
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }

    if (user) {
      await setAuthCookies(req, res, { user, platform });
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
