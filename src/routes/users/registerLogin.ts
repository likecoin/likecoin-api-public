import { Router } from 'express';
import Multer from 'multer';
import RateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { checksumAddress } from 'viem';
import {
  PUBSUB_TOPIC_MISC,
  TEST_MODE,
} from '../../constant';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import {
  checkCosmosSignPayload,
  setAuthCookies,
  clearAuthCookies,
  userOrWalletByEmailQuery,
  normalizeUserEmail,
  checkEVMSignPayload,
} from '../../util/api/users';
import { handleUserRegistration } from '../../util/api/users/register';
import logPixelEvents from '../../util/fbq';
import { ValidationError } from '../../util/ValidationError';
import { supportedLocales, defaultLocale } from '../../locales';
import { handleAvatarUploadAndGetURL } from '../../util/fileupload';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { validateBody } from '../../middleware/validate';
import {
  UsersUpdateAvatarBodySchema,
  UsersUpdateBodySchema,
  UsersEmailCheckBodySchema,
  UsersRegisterBodySchema,
  UsersLoginBodySchema,
  UsersUpdateAvatarResponseSchema,
} from '../../util/api/users/schemas';
import { authCoreJwtVerify } from '../../util/jwt';
import publisher from '../../util/gcloudPub';
import {
  REGISTER_LIMIT_WINDOW,
  REGISTER_LIMIT_COUNT,
} from '../../../config/config';

import {
  isValidLikeAddress,
} from '../../util/cosmos';
import { getMagicUserMetadataByDIDToken, verifyEmailByMagicUserMetadata } from '../../util/magic';

export const THIRTY_S_IN_MS = 30000;

const multer = Multer({
  storage: Multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // no larger than 5mb, you can change as needed.
  },
});

const router = Router();

const apiLimiter = RateLimit({
  windowMs: REGISTER_LIMIT_WINDOW,
  max: TEST_MODE ? Number.MAX_SAFE_INTEGER : REGISTER_LIMIT_COUNT || Number.MAX_SAFE_INTEGER,
  skipFailedRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.headers['x-real-ip'] as string || req.ip || ''),
});

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
  validateBody(UsersRegisterBodySchema),
  async (req, res, next) => {
    const {
      platform,
      user,
      displayName,
      description,
      locale: inputLocale,
    } = req.body;
    let email;
    try {
      let locale = inputLocale;
      if (!locale) {
        locale = defaultLocale;
      } else if (!supportedLocales.includes(locale)) {
        throw new ValidationError('INVALID_LOCALE');
      }
      let payload;
      switch (platform) {
        case 'evmWallet': {
          const {
            from: inputWallet,
            payload: stringPayload,
            sign,
            magicDIDToken,
          } = req.body;
          checkEVMSignPayload({
            signature: sign,
            message: stringPayload,
            inputWallet,
            action: 'register',
          });
          payload = req.body;
          payload.evmWallet = checksumAddress(inputWallet);
          payload.displayName = displayName || user;
          ({ email } = req.body);
          payload.isEmailVerified = false;
          if (magicDIDToken) {
            const magicUserMetadata = await getMagicUserMetadataByDIDToken(magicDIDToken);
            payload.magicUserId = magicUserMetadata.issuer;
            if (!verifyEmailByMagicUserMetadata(email, magicUserMetadata)) {
              throw new ValidationError('MAGIC_EMAIL_MISMATCH');
            }
            payload.isEmailVerified = true;
          }
          payload.email = email;
          break;
        }
        default:
          throw new ValidationError('INVALID_PLATFORM');
      }
      const {
        userPayload,
      } = await handleUserRegistration({
        payload: {
          ...payload,
          description,
          locale,
          platform,
        },
        req,
        res,
      });

      await setAuthCookies(req, res, { user, platform });
      res.sendStatus(200);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        ...userPayload,
        logType: 'eventUserRegister',
      });
      // Server-side Meta CAPI CompleteRegistration (Pixel only); browser fires GA4/PostHog sign_up.
      // Meta dedups on event_id — the lowercased wallet matches the browser key, merging the pair.
      // PostHog can't dedup sign_up: it fires pre-identify, so distinct_id differs from the wallet.
      logPixelEvents('CompleteRegistration', {
        email: userPayload.email,
        evmWallet: userPayload.evmWallet,
        paymentId: userPayload.evmWallet
          ? userPayload.evmWallet.toLowerCase()
          : undefined,
        userAgent: req.get('User-Agent'),
        clientIp: (req.headers['x-real-ip'] as string) || req.ip,
        referrer: userPayload.sourceURL,
        fbClickId: req.body.fbClickId,
        fbp: req.body.fbp,
        fbc: req.body.fbc,
      });
    } catch (err) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventRegisterError',
        platform,
        user,
        email,
        error: (err as Error).message || JSON.stringify(err),
      });
      next(err);
    }
  },
);

router.post(
  '/update',
  jwtAuth('write:profile'),
  validateBody(UsersUpdateBodySchema),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const {
        email,
        magicDIDToken,
        displayName,
        description,
        locale: inputLocale,
      } = req.body;
      let locale;
      if (inputLocale !== undefined) {
        if (!inputLocale) {
          locale = defaultLocale;
        } else if (!supportedLocales.includes(inputLocale)) {
          throw new ValidationError('INVALID_LOCALE');
        } else {
          locale = inputLocale;
        }
      }
      let { isEmailEnabled } = req.body;

      // handle isEmailEnable is string
      if (typeof isEmailEnabled === 'string') {
        isEmailEnabled = isEmailEnabled !== 'false';
      }
      const oldUserObj = await dbRef.doc(user).get();
      const oldUserData = oldUserObj.data();
      if (!oldUserData) {
        throw new ValidationError('USER_NOT_FOUND');
      }
      const {
        wallet,
        referrer,
        avatar,
        timestamp,
        displayName: oldDisplayName,
        email: oldEmail,
        locale: oldLocale,
        evmWallet,
        magicUserId,
      } = oldUserData;

      const updateObj: any = {
        displayName,
        description,
        isEmailEnabled,
        locale,
      };

      if (email) {
        const isEmailChanged = email.toLowerCase() !== (oldEmail || '').toLowerCase();
        // Process when the email changes, or when a Magic token is present so an
        // unchanged email can still re-verify and backfill magicUserId. A wallet
        // user resubmitting an unchanged email (no token) keeps isEmailVerified.
        if (isEmailChanged || magicDIDToken) {
          // Magic OTP-verifies email changes, so a DID token lets us keep
          // isEmailVerified; wallet users (no token) reset it.
          let isEmailVerified = false;
          if (magicDIDToken) {
            const magicUserMetadata = await getMagicUserMetadataByDIDToken(magicDIDToken);
            if (magicUserId && magicUserMetadata.issuer !== magicUserId) {
              throw new ValidationError('MAGIC_USER_MISMATCH');
            }
            if (!verifyEmailByMagicUserMetadata(email, magicUserMetadata)) {
              throw new ValidationError('MAGIC_EMAIL_MISMATCH');
            }
            // Some users were migrated without a magicUserId. Backfill it from the
            // token only when its wallet matches the account's evmWallet, so an
            // authenticated session can't bind an unrelated Magic identity.
            if (!magicUserId) {
              if (!evmWallet
                || magicUserMetadata.publicAddress?.toLowerCase() !== evmWallet.toLowerCase()) {
                throw new ValidationError('MAGIC_USER_MISMATCH');
              }
              updateObj.magicUserId = magicUserMetadata.issuer;
            }
            isEmailVerified = true;
          }
          // Uniqueness and normalization only matter when the email actually changes.
          if (isEmailChanged) {
            await userOrWalletByEmailQuery({ user }, email);
            const {
              normalizedEmail,
              isEmailBlacklisted,
              isEmailDuplicated,
            } = await normalizeUserEmail(user, email);
            if (!normalizedEmail) {
              throw new ValidationError('EMAIL_FORMAT_INCORRECT');
            }
            updateObj.email = email;
            updateObj.normalizedEmail = normalizedEmail;
            if (isEmailBlacklisted !== undefined) updateObj.isEmailBlacklisted = isEmailBlacklisted;
            if (isEmailDuplicated !== undefined) updateObj.isEmailDuplicated = isEmailDuplicated;
          }
          updateObj.isEmailVerified = isEmailVerified;
        }
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
  '/email/check',
  jwtAuth('write:profile'),
  validateBody(UsersEmailCheckBodySchema),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const { email } = req.body;
      // Advisory pre-check before a Magic email change, mirroring /update's only
      // reachable error here: EMAIL_ALREADY_USED if another user holds the email
      // (self excluded). Format is already rejected by the shared zod .email() schema.
      await userOrWalletByEmailQuery({ user }, email);
      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/update/avatar',
  jwtAuth('write:profile'),
  multer.single('avatarFile'),
  validateBody(UsersUpdateAvatarBodySchema),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const { avatarSHA256 } = req.body;
      const { file } = req;
      let avatarUrl;
      let avatarHash;
      if (!file) throw new ValidationError('MISSING_AVATAR_FILE');
      try {
        ({
          url: avatarUrl,
          hash: avatarHash,
        } = await handleAvatarUploadAndGetURL(user, file, avatarSHA256));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Avatar file handling error:');
        // eslint-disable-next-line no-console
        console.error(err);
        throw new ValidationError('INVALID_AVATAR');
      }

      const payload: any = { avatar: avatarUrl };
      if (avatarHash) payload.avatarHash = avatarHash;
      await dbRef.doc(user).update(payload);
      sendValidatedJSON(res, UsersUpdateAvatarResponseSchema, {
        avatar: avatarUrl,
      });

      const oldUserObj = await dbRef.doc(user).get();
      const oldUserData = oldUserObj.data();
      if (oldUserData) {
        const {
          wallet,
          referrer,
          timestamp,
          displayName,
          email,
          locale,
        } = oldUserData;
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
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post('/login', validateBody(UsersLoginBodySchema), async (req, res, next) => {
  try {
    let user;
    let wallet;
    let authCoreUserId;
    const {
      platform,
      sourceURL,
      utmSource,
    } = req.body;

    switch (platform) {
      case 'evmWallet': {
        const {
          from,
          payload: stringPayload,
          sign,
        } = req.body;
        wallet = checksumAddress(from);
        checkEVMSignPayload({
          signature: sign,
          message: stringPayload,
          inputWallet: wallet,
          action: 'login',
        });
        const userQuery = await (
          dbRef
            .where('evmWallet', '==', wallet)
            .get()
        );
        if (userQuery.docs.length > 0) {
          const [userDoc] = userQuery.docs;
          user = userDoc.id;
        }
        break;
      }
      case 'likeWallet': {
        const {
          from: inputWallet, signature, publicKey, message, signMethod,
        } = req.body;
        if (!inputWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
        if (platform === 'likeWallet' && !isValidLikeAddress(inputWallet)) throw new ValidationError('INVALID_LIKE_ADDRESS');
        if (!checkCosmosSignPayload({
          signature, publicKey, message, inputWallet, signMethod,
        })) {
          throw new ValidationError('INVALID_SIGN');
        }
        const userQuery = await (
          dbRef
            .where('likeWallet', '==', inputWallet)
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
        } = authCoreUser);
        const userQuery = await (
          dbRef
            .where('authCoreUserId', '==', authCoreUserId)
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
        const docData = doc.data();
        if (docData) {
          const {
            isLocked,
          } = docData;
          if (isLocked) {
            // eslint-disable-next-line no-console
            console.log(`Locked user: ${user}`);
            throw new ValidationError('USER_LOCKED');
          }
        }
      }
      await setAuthCookies(req, res, { user, platform });
      res.sendStatus(200);

      if (doc.exists) {
        const docData = doc.data();
        if (docData) {
          const {
            email,
            displayName,
            referrer,
            locale,
            timestamp: registerTime,
          } = docData;
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
        // eslint-disable-next-line no-console
        console.error(err);
      }
      const doc = await dbRef.doc(user).get();
      if (doc.exists) {
        const docData = doc.data();
        if (docData) {
          const {
            wallet,
            email,
            displayName,
            referrer,
            locale,
            timestamp: registerTime,
          } = docData;
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
    }
  } catch (err) {
    next(err);
  }
});

export default router;
