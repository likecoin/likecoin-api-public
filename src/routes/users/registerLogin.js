import { Router } from 'express';
import bodyParser from 'body-parser';
import csrf from 'csurf';
import { sendVerificationEmail } from '../../util/ses';
import {
  PUBSUB_TOPIC_MISC,
  CSRF_COOKIE_OPTION,
} from '../../constant';
import { fetchFacebookUser } from '../../util/oauth/facebook';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  FieldValue,
  admin,
} from '../../util/firebase';
import {
  handleEmailBlackList,
  checkReferrerExists,
  checkUserInfoUniqueness,
  checkIsOldUser,
  checkSignPayload,
  setAuthCookies,
  checkEmailIsSoleLogin,
  clearAuthCookies,
  tryToLinkOAuthLogin,
  tryToUnlinkOAuthLogin,
} from '../../util/api/users';
import { tryToLinkSocialPlatform } from '../../util/api/social';
import { ValidationError } from '../../util/ValidationError';
import {
  checkUserNameValid,
} from '../../util/ValidationHelper';
import { handleAvatarUploadAndGetURL } from '../../util/fileupload';
import { jwtAuth } from '../../middleware/jwt';
import publisher from '../../util/gcloudPub';
import { getFirebaseUserProviderUserInfo } from '../../util/FirebaseApp';
import {
  REGISTER_LIMIT_WINDOW,
  REGISTER_LIMIT_COUNT,
  NEW_USER_BONUS_COOLDOWN,
} from '../../../config/config';

const Multer = require('multer');
const uuidv4 = require('uuid/v4');
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

function getBool(value = false) {
  if (typeof value === 'string') {
    return value !== 'false';
  }
  return value;
}

router.post(
  '/new',
  csrf({ cookie: CSRF_COOKIE_OPTION }),
  bodyParser.urlencoded({ extended: false }),
  apiLimiter,
  multer.single('avatarFile'),
  async (req, res, next) => {
    try {
      let payload;
      let firebaseUserId;
      let platformUserId;
      let isEmailVerified = false;

      const { platform } = req.body;
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
          payload.referrer = referrer;
          payload.sourceURL = sourceURL;
          break;
        }
        case 'email':
        case 'google':
        case 'twitter': {
          const { firebaseIdToken } = req.body;
          ({ uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken));
          payload = req.body;

          // Set verified to the email if it matches Firebase verified email
          const firebaseUser = await admin.auth().getUser(firebaseUserId);
          isEmailVerified = firebaseUser.email === payload.email && firebaseUser.emailVerified;

          switch (platform) {
            case 'google':
            case 'twitter': {
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
        case 'facebook': {
          const { accessToken } = req.body;
          const { userId, email } = await fetchFacebookUser(accessToken);
          payload = req.body;
          if (userId !== payload.platformUserId) {
            throw new ValidationError('USER_ID_NOT_MTACH');
          }
          platformUserId = userId;

          // Set verified to the email if it matches Facebook verified email
          isEmailVerified = email === payload.email;

          // Verify Firebase user ID
          const { firebaseIdToken } = req.body;
          ({ uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken));
          break;
        }
        default:
          throw new ValidationError('INVALID_PLATFORM');
      }

      const {
        user,
        displayName = user,
        wallet,
        avatarSHA256,
        referrer,
        locale = 'en',
        accessToken,
        secret,
        sourceURL,
      } = payload;
      let { email, isEmailEnabled = true } = payload;

      isEmailEnabled = getBool(isEmailEnabled);

      if (!checkUserNameValid(user)) throw new ValidationError('Invalid user name');

      if (email) {
        try {
          email = handleEmailBlackList(email);
        } catch (err) {
          if (err.message === 'DOMAIN_NOT_ALLOWED' || err.message === 'DOMAIN_NEED_EXTRA_CHECK') {
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventBlockEmail',
              user,
              email,
              displayName,
              wallet,
              referrer: referrer || undefined,
              locale,
            });
          }
          throw err;
        }
      }

      const isNew = await checkUserInfoUniqueness({
        user,
        wallet,
        email,
        firebaseUserId,
        platform,
        platformUserId,
      });
      if (!isNew) throw new ValidationError('USER_ALREADY_EXIST');

      // upload avatar
      const { file } = req;
      let avatarUrl;
      if (file) {
        avatarUrl = await handleAvatarUploadAndGetURL(user, file, avatarSHA256);
      }
      let hasReferrer = false;
      if (referrer) {
        try {
          hasReferrer = await checkReferrerExists(referrer);
        } catch (err) {
          if (err.message === 'REFERRER_LIMIT_EXCCEDDED') {
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventBlockReferrer',
              user,
              email,
              displayName,
              wallet,
              referrer,
              locale,
            });
          }
          throw err;
        }
      }
      const createObj = {
        displayName,
        wallet,
        isEmailEnabled,
        firebaseUserId,
        avatar: avatarUrl,
        locale,
      };

      if (hasReferrer) createObj.referrer = referrer;

      if (email) {
        createObj.email = email;
        createObj.isEmailVerified = isEmailVerified;

        // Hack for setting done to verifyEmail mission
        if (isEmailVerified) {
          await dbRef
            .doc(user)
            .collection('mission')
            .doc('verifyEmail')
            .set({ done: true }, { merge: true });
        } else {
          // Send verify email
          createObj.lastVerifyTs = Date.now();
          createObj.verificationUUID = uuidv4();

          try {
            await sendVerificationEmail(res, {
              email,
              displayName,
              verificationUUID: createObj.verificationUUID,
            }, createObj.referrer);
          } catch (err) {
            console.error(err);
            // Do nothing
          }
        }
      }

      const timestampObj = { timestamp: Date.now() };
      if (NEW_USER_BONUS_COOLDOWN) {
        timestampObj.bonusCooldown = Date.now() + NEW_USER_BONUS_COOLDOWN;
      }
      Object.assign(createObj, timestampObj);

      Object.keys(createObj).forEach((key) => {
        if (createObj[key] === undefined) {
          delete createObj[key];
        }
      });

      await dbRef.doc(user).create(createObj);
      if (hasReferrer) {
        await dbRef.doc(referrer).collection('referrals').doc(user).create({
          ...timestampObj,
          isEmailVerified,
        });
      }

      // platformUserId is only set when the platform is valid
      if (platformUserId) {
        const doc = {
          [platform]: {
            userId: platformUserId,
          },
        };
        await authDbRef.doc(user).create(doc);
      }

      const socialPayload = await tryToLinkSocialPlatform(user, platform, { accessToken, secret });

      await setAuthCookies(req, res, { user, wallet });
      res.sendStatus(200);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventUserRegister',
        user,
        email: email || undefined,
        displayName,
        wallet,
        avatar: avatarUrl,
        referrer: referrer || undefined,
        locale,
        registerTime: createObj.timestamp,
        registerMethod: platform,
        sourceURL,
      });
      if (socialPayload) {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventSocialLink',
          platform,
          user,
          email: email || undefined,
          displayName,
          wallet,
          referrer: referrer || undefined,
          locale,
          registerTime: createObj.timestamp,
          ...socialPayload,
        });
      }
    } catch (err) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventRegisterError',
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

      case 'email':
      case 'google':
      case 'twitter': {
        const { firebaseIdToken } = req.body;
        const { uid: firebaseUserId } = await admin.auth().verifyIdToken(firebaseIdToken);
        const firebaseUser = await admin.auth().getUser(firebaseUserId);
        switch (platform) {
          case 'email': {
            // Enable user to sign in with Firebase Email Auth Provider
            // if there exists a user with that email
            try {
              const { email } = req.body;
              if (email === firebaseUser.email && firebaseUser.emailVerified) {
                const userQuery = await dbRef.where('email', '==', email).get();
                if (userQuery.docs.length > 0) {
                  const [userDoc] = userQuery.docs;
                  const { firebaseUserId: currentFirebaseUserId } = userDoc.data();
                  if (currentFirebaseUserId && firebaseUserId !== currentFirebaseUserId) {
                    throw new Error('USER_ID_ALREADY_LINKED');
                  }
                  await userDoc.ref.update({
                    firebaseUserId,
                    isEmailVerified: true,
                  });
                  user = userDoc.id;
                }
              }
            } catch (err) {
              // Do nothing
            }
            break;
          }

          case 'google':
          case 'twitter': {
            const userInfo = getFirebaseUserProviderUserInfo(firebaseUser, platform);
            if (userInfo) {
              const userQuery = await (
                authDbRef
                  .where(`${platform}.userId`, '==', userInfo.uid)
                  .get()
              );
              if (userQuery.docs.length > 0) {
                const [userDoc] = userQuery.docs;
                user = userDoc.id;
              }
            }
            break;
          }

          default:
        }
        break;
      }

      case 'facebook': {
        try {
          const { accessToken, platformUserId } = req.body;
          const { userId } = await fetchFacebookUser(accessToken);
          if (userId !== platformUserId) {
            throw new ValidationError('USER_ID_NOT_MTACH');
          }
          const query = (
            await authDbRef
              .where(`${platform}.userId`, '==', platformUserId)
              .limit(1)
              .get()
          );
          if (query.docs.length > 0) {
            user = query.docs[0].id;
          }
        } catch (err) {
          console.log(err);
          // do nothing
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
      case 'twitter': {
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

        if (platform === 'twitter') {
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
