import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  handleEmailBlackList,
  checkUserInfoUniqueness,
} from '../../util/api/users';
import {
  handleUserRegistration,
  suggestAvailableUserName,
} from '../../util/api/users/register';
import { autoGenerateUserTokenForClient } from '../../util/api/oauth';
import { ValidationError } from '../../util/ValidationError';
import publisher from '../../util/gcloudPub';

const router = Router();

router.post('/new/check', async (req, res, next) => {
  try {
    const {
      user,
      wallet,
    } = req.body;
    let { email } = req.body;
    try {
      if (email) email = handleEmailBlackList(email);
      const isNew = await checkUserInfoUniqueness({
        user,
        wallet,
        email,
      });
      if (!isNew) throw new ValidationError('USER_ALREADY_EXIST');
    } catch (err) {
      if (err instanceof ValidationError) {
        const payload = { error: err.message };
        if (err.message === 'USER_ALREADY_EXIST') {
          const suggestName = await suggestAvailableUserName(user);
          payload.alternative = suggestName;
        }
        res.status(400).json(payload);
        return;
      }
      throw err;
    }

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/new/:platform', async (req, res, next) => {
  const {
    platform,
  } = req.params;
  const {
    user,
    displayName = user,
    locale = 'en',
    isEmailEnabled = true,
  } = req.body;
  const {
    email,
  } = req.body;
  try {
    let platformUserId;
    let isEmailVerified = false;
    let autoLinkOAuth = false;

    switch (platform) {
      case 'matters': {
        const { token } = req.body;
        // TODO: query matters to verify
        platformUserId = token;
        isEmailVerified = true;
        autoLinkOAuth = true;
        res.json({
          accessToken: 'to be implemented',
          refreshToken: 'to be implemented',
          scope: ['profile', 'email', 'like'],
        });
        return;
        // break;
      }
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }
    // TODO: remove line below
    /* eslint-disable no-unreachable */
    const {
      userPayload,
      socialPayload,
    } = await handleUserRegistration({
      payload: {
        platform,
        user,
        displayName,
        locale,
        isEmailEnabled,
        email,
        platformUserId,
        isEmailVerified,
      },
      res,
      req,
    });
    let accessToken;
    let refreshToken;
    let scope;
    if (autoLinkOAuth) {
      ({
        accessToken,
        refreshToken,
        scope,
      } = await autoGenerateUserTokenForClient(req, platform, user));
    }
    res.json({
      accessToken,
      refreshToken,
      scope,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      ...userPayload,
      logType: 'eventAPIUserRegister',
    });
    if (socialPayload) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        ...userPayload,
        ...socialPayload,
        logType: 'eventAPISocialLink',
      });
    }
  } catch (err) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventAPIRegisterError',
      platform,
      user,
      email,
      error: err.message || JSON.stringify(err),
    });
    next(err);
  }
});

export default router;
