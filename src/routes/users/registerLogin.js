import { Router } from 'express';
import bodyParser from 'body-parser';
import csrf from 'csurf';
import {
  PUBSUB_TOPIC_MISC,
  CSRF_COOKIE_OPTION,
} from '../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
} from '../../util/firebase';
import {
  getAuthCoreUser,
  updateAuthCoreUserById,
  createAuthCoreCosmosWalletViaUserToken,
  getAuthCoreUserOAuthFactors,
} from '../../util/authcore';
import {
  checkSignPayload,
  setAuthCookies,
  clearAuthCookies,
  userByEmailQuery,
  normalizeUserEmail,
  getUserAgentIsApp,
} from '../../util/api/users';
import { handleUserRegistration } from '../../util/api/users/register';
import { handleAppReferrer, handleUpdateAppMetaData } from '../../util/api/users/app';
import { ValidationError } from '../../util/ValidationError';
import { handleAvatarUploadAndGetURL } from '../../util/fileupload';
import { jwtAuth } from '../../middleware/jwt';
import { authCoreJwtSignToken, authCoreJwtVerify } from '../../util/jwt';
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

function csrfCheck(req, res, next) {
  const { 'user-agent': userAgent = '' } = req.headers;
  if (userAgent.includes('LikeCoinApp')) {
    next();
  } else {
    csrf({ cookie: CSRF_COOKIE_OPTION })(req, res, next);
  }
}

router.post(
  '/new',
  csrfCheck,
  bodyParser.urlencoded({ extended: false }),
  apiLimiter,
  multer.single('avatarFile'),
  async (req, res, next) => {
    const {
      platform,
      appReferrer,
      user,
    } = req.body;
    let email;
    try {
      let payload;
      let platformUserId;

      switch (platform) {
        case 'authcore': {
          const {
            idToken,
            accessToken,
          } = req.body;
          if (!idToken) throw new ValidationError('ID_TOKEN_MISSING');
          if (!accessToken) throw new ValidationError('ACCESS_TOKEN_MISSING');
          const authCoreUser = authCoreJwtVerify(idToken);
          const {
            sub: authCoreUserId,
            email: authCoreEmail,
            email_verified: isAuthCoreEmailVerified,
            phone_number: authCorePhone,
            phone_number_verified: isAuthCorePhoneVerified,
          } = authCoreUser;
          payload = req.body;
          payload.authCoreUserId = authCoreUserId;
          if (!payload.cosmosWallet) {
            payload.cosmosWallet = await createAuthCoreCosmosWalletViaUserToken(accessToken);
          }
          email = authCoreEmail;
          // TODO: remove this displayname hack after authcore fix default name privacy issue
          payload.displayName = user;
          payload.email = email;
          payload.isEmailVerified = isAuthCoreEmailVerified;
          if (authCorePhone) {
            payload.phone = authCorePhone;
            payload.isPhoneVerified = isAuthCorePhoneVerified;
          }
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
          ...payload,
          platform,
          platformUserId,
        },
        res,
        req,
      });

      if (platform === 'authcore') {
        try {
          const authCoreToken = await authCoreJwtSignToken();
          await updateAuthCoreUserById(
            payload.authCoreUserId,
            {
              user,
              displayName: payload.displayName || user,
            },
            authCoreToken,
          );
        } catch (err) {
          /* no update will return 400 error */
          if (!err.response || err.response.status !== 400) console.error(err);
        }
      }

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
      if (getUserAgentIsApp(req)) {
        if (appReferrer) {
          await handleAppReferrer(req, userPayload, appReferrer);
        } else {
          await handleUpdateAppMetaData(req, userPayload);
        }
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
        email,
        displayName,
        avatarSHA256,
        locale,
      } = req.body;
      let { isEmailEnabled } = req.body;

      // handle isEmailEnable is string
      if (typeof isEmailEnabled === 'string') {
        isEmailEnabled = isEmailEnabled !== 'false';
      }
      const oldUserObj = await dbRef.doc(user).get();
      const {
        wallet,
        referrer,
        displayName: oldDisplayName,
        email: oldEmail,
        locale: oldLocale,
      } = oldUserObj.data();

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
      if (!oldEmail && email) {
        await userByEmailQuery(user, email);
        updateObj.email = email;
        const {
          normalizedEmail,
          isEmailBlacklisted,
          isEmailDuplicated,
        } = await normalizeUserEmail(user, email);
        if (normalizedEmail) updateObj.normalizedEmail = normalizedEmail;
        if (isEmailBlacklisted !== undefined) updateObj.isEmailBlacklisted = isEmailBlacklisted;
        if (isEmailDuplicated !== undefined) updateObj.isEmailDuplicated = isEmailDuplicated;
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
        ...updateObj,
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
      phone,
      isPhoneVerified,
    } = await getAuthCoreUser(authCoreAccessToken);
    const updateObj = {
      email,
      displayName,
      isEmailVerified,
      phone,
      isPhoneVerified,
    };
    if (email) {
      const {
        normalizedEmail,
        isEmailBlacklisted,
        isEmailDuplicated,
      } = await normalizeUserEmail(user, email);
      if (normalizedEmail) updateObj.normalizedEmail = normalizedEmail;
      if (isEmailBlacklisted !== undefined) updateObj.isEmailBlacklisted = isEmailBlacklisted;
      if (isEmailDuplicated !== undefined) updateObj.isEmailDuplicated = isEmailDuplicated;
    }
    await dbRef.doc(user).update(updateObj);
    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventUserSync',
      type: 'authcore',
      user,
      ...updateObj,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    let user;
    let wallet;
    let authCoreUserName;
    let authCoreUserId;
    const {
      platform,
      appReferrer,
    } = req.body;

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
        ({
          sub: authCoreUserId,
          /* TODO: remove after most lazy update of user id is done */
          preferred_username: authCoreUserName,
        } = authCoreUser);
        const userQuery = await (
          authDbRef
            .where(`${platform}.userId`, '==', authCoreUserId)
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
      const doc = await dbRef.doc(user).get();
      if (doc.exists) {
        const {
          isBlackListed,
        } = doc.data();
        if (isBlackListed) throw new ValidationError('INVALID_USER');
      }
      await setAuthCookies(req, res, { user, platform });
      res.sendStatus(200);

      if (doc.exists) {
        const {
          email,
          displayName,
          referrer,
          locale,
          cosmosWallet,
          timestamp: registerTime,
        } = doc.data();
        if (platform === 'authcore' && req.body.accessToken) {
          const { accessToken } = req.body;
          if (!cosmosWallet) {
            const newWallet = await createAuthCoreCosmosWalletViaUserToken(accessToken);
            await dbRef.doc(user).update({ cosmosWallet: newWallet });
          }
          const oAuthFactors = await getAuthCoreUserOAuthFactors(accessToken);
          if (oAuthFactors && oAuthFactors.length) {
            const payload = oAuthFactors.reduce((acc, f) => {
              acc[f.service] = { userId: f.userId };
              return acc;
            }, {});
            await authDbRef.doc(user).update(payload);
          }
          if (!authCoreUserName) {
            try {
              const authCoreToken = await authCoreJwtSignToken();
              await updateAuthCoreUserById(
                authCoreUserId,
                {
                  user,
                  displayName,
                },
                authCoreToken,
              );
            } catch (err) {
              /* no update will return 400 error */
              if (!err.response || err.response.status !== 400) console.error(err);
            }
          }
        }
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
      if (getUserAgentIsApp(req)) {
        const userObject = { user, ...doc.data() };
        if (appReferrer) {
          await handleAppReferrer(req, userObject, appReferrer);
        } else {
          await handleUpdateAppMetaData(req, userObject);
        }
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
