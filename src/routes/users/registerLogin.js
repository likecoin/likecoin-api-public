import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
  TEST_MODE,
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
  checkCosmosSignPayload,
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
import { convertAddressPrefix } from '../../util/cosmos';

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

function isJson(req) {
  return !!req.is('application/json');
}

function isApp(req) {
  const { 'user-agent': userAgent = '' } = req.headers;
  return userAgent.includes('LikeCoinApp');
}

function formdataParserForApp(req, res, next) {
  if (!isJson(req)) {
    if (isApp(req)) {
      multer.none()(req, res, next);
    } else {
      next(new ValidationError('INVALID_CONTENT_TYPE'));
    }
  } else {
    next();
  }
}

router.post(
  '/new',
  formdataParserForApp,
  apiLimiter,
  async (req, res, next) => {
    const {
      platform,
      appReferrer,
      user,
      displayName,
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
          let authCoreUser;
          try {
            authCoreUser = authCoreJwtVerify(idToken);
            if (!authCoreUser) throw new ValidationError('AUTHCORE_USER_NOT_EXIST');
          } catch (err) {
            throw new ValidationError('ID_TOKEN_INVALID');
          }

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
            try {
              const cosmosWallet = await createAuthCoreCosmosWalletViaUserToken(accessToken);
              payload.cosmosWallet = cosmosWallet;
            } catch (err) {
              console.error('Cannot create cosmos wallet');
              console.error(err);
              throw new ValidationError('COSMOS_WALLET_PENDING');
            }
          }
          if (!payload.likeWallet && payload.cosmosWallet) {
            try {
              const likeWallet = await convertAddressPrefix(payload.cosmosWallet, 'like');
              payload.likeWallet = likeWallet;
            } catch (err) {
              console.error('Cannot create cosmos wallet');
              console.error(err);
              throw new ValidationError('COSMOS_WALLET_PENDING');
            }
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
        case 'likeWallet':
        case 'cosmosWallet': {
          const {
            from: inputWallet, signature, publicKey, message,
          } = req.body;
          ({ email } = req.body);
          if (!inputWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
          if (platform === 'likeWallet' && !inputWallet.startsWith('like')) throw new ValidationError('INVALID_LIKE_PREFIX');
          if (platform === 'cosmosWallet' && !inputWallet.startsWith('cosmos')) throw new ValidationError('INVALID_COSMOS_PREFIX');
          if (!checkCosmosSignPayload({
            signature, publicKey, message, inputWallet,
          })) {
            throw new ValidationError('INVALID_SIGN');
          }
          payload = req.body;
          payload.cosmosWallet = convertAddressPrefix(inputWallet, 'cosmos');
          payload.likeWallet = convertAddressPrefix(inputWallet, 'like');
          payload.displayName = displayName || user;
          payload.email = email;
          payload.isEmailVerified = false;
          platformUserId = inputWallet;
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

      if (platform === 'authcore' && !TEST_MODE) {
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
  jwtAuth('write'),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const {
        email,
        displayName,
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
        avatar,
        timestamp,
        displayName: oldDisplayName,
        email: oldEmail,
        locale: oldLocale,
      } = oldUserObj.data();

      const updateObj = {
        displayName,
        isEmailEnabled,
        locale,
      };

      if (email) {
        if (oldEmail) throw new ValidationError('EMAIL_CANNOT_BE_CHANGED');
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

      if (!Object.keys(updateObj).length) {
        throw new ValidationError('INVALID_PAYLOAD');
      }
      await dbRef.doc(user).update(updateObj);
      res.sendStatus(200);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventUserUpdate',
        user,
        ...updateObj,
        email: email || oldEmail,
        displayName: displayName || oldDisplayName,
        wallet,
        avatar,
        referrer,
        locale: locale || oldLocale,
        registerTime: timestamp,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/update/avatar',
  jwtAuth('write'),
  multer.single('avatarFile'),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const { avatarSHA256 } = req.body;
      const { file } = req;
      let avatarUrl;
      if (file) {
        try {
          avatarUrl = await handleAvatarUploadAndGetURL(user, file, avatarSHA256);
        } catch (err) {
          console.error('Avatar file handling error:');
          console.error(err);
          throw new ValidationError('INVALID_AVATAR');
        }
      }

      await dbRef.doc(user).update({ avatar: avatarUrl });
      res.sendStatus(200);

      const oldUserObj = await dbRef.doc(user).get();
      const {
        wallet,
        referrer,
        timestamp,
        displayName,
        email,
        locale,
      } = oldUserObj.data();
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventUserAvatarUpdate',
        user,
        wallet,
        referrer,
        displayName,
        email,
        locale,
        avatar: avatarUrl,
        registerTime: timestamp,
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
      sourceURL,
      utmSource,
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
      case 'likeWallet':
      case 'cosmosWallet': {
        const {
          from: inputWallet, signature, publicKey, message,
        } = req.body;
        if (!inputWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
        if (platform === 'likeWallet' && !inputWallet.startsWith('like')) throw new ValidationError('INVALID_LIKE_PREFIX');
        if (platform === 'cosmosWallet' && !inputWallet.startsWith('cosmos')) throw new ValidationError('INVALID_COSMOS_PREFIX');
        if (!checkCosmosSignPayload({
          signature, publicKey, message, inputWallet,
        })) {
          throw new ValidationError('INVALID_SIGN');
        }
        const userQuery = await (
          authDbRef
            .where(`${platform}.userId`, '==', inputWallet)
            .get()
        );
        if (userQuery.docs.length > 0) {
          const [userDoc] = userQuery.docs;
          user = userDoc.id;
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
          isLocked,
        } = doc.data();
        if (isLocked) {
          console.log(`Locked user: ${user}`);
          throw new ValidationError('USER_LOCKED');
        }
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
          likeWallet,
          timestamp: registerTime,
        } = doc.data();
        if (platform === 'authcore' && req.body.accessToken && !TEST_MODE) {
          const { accessToken } = req.body;
          if (!cosmosWallet) {
            const newWallet = await createAuthCoreCosmosWalletViaUserToken(accessToken);
            const newLikeWallet = convertAddressPrefix(newWallet, 'like');
            await dbRef.doc(user).update({ cosmosWallet: newWallet, likeWallet: newLikeWallet });
          }
          if (!likeWallet && cosmosWallet) {
            const newLikeWallet = convertAddressPrefix(cosmosWallet, 'like');
            await dbRef.doc(user).update({ likeWallet: newLikeWallet });
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
          sourceURL,
          utmSource,
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
