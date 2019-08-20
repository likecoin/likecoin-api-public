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
  checkUserEmailUsable,
} from '../../util/api/users/register';
import { autoGenerateUserTokenForClient } from '../../util/api/oauth';
import { handleClaimPlatformDelegatedUser } from '../../util/api/users/platforms';
import { fetchMattersUser } from '../../util/oauth/matters';
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
  let {
    email,
  } = req.body;
  try {
    let platformUserId;
    let isEmailVerified = false;
    let autoLinkOAuth = false;

    switch (platform) {
      case 'matters': {
        const { token } = req.body;
        if (email) {
          if (!await checkUserEmailUsable(user, email)) {
            email = '';
          }
        }
        const { userId } = await fetchMattersUser({ accessToken: token });
        // TODO: query matters to verify
        platformUserId = userId;
        isEmailVerified = true;
        autoLinkOAuth = true;
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

router.post('/edit/:platform', async (req, res, next) => {
  const { platform } = req.params;
  const { user } = req.body;
  try {
    switch (platform) {
      case 'matters': {
        const {
          action,
          token,
          payload,
        } = req.body;
        switch (action) {
          case 'claim': {
            const {
              userId,
              email,
              displayName,
            } = await fetchMattersUser({ accessToken: token });
            const isEmailVerified = true;
            await handleClaimPlatformDelegatedUser(platform, user, {
              email,
              displayName,
              isEmailVerified,
            });
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventClaimMattersDelegatedUser',
              matterUserId: userId,
              user,
              email,
              displayName,
            });
            res.sendStatus(200);
            break;
          }
          case 'transfer': {
            const {
              toUserId,
              fromUserId,
            } = payload;
            await handleClaimPlatformDelegatedUser(platform, fromUserId, toUserId);
            const {
              accessToken,
              refreshToken,
              scope,
            } = await autoGenerateUserTokenForClient(req, platform, toUserId);
            res.json({
              accessToken,
              refreshToken,
              scope,
            });
            break;
          }
          default:
            throw new ValidationError('UNKNOWN_ACTION');
        }
        break;
      }
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }
  } catch (err) {
    next(err);
  }
});

export default router;
