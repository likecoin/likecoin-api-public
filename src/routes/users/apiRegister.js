import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import { getOAuthClientInfo } from '../../middleware/oauth';
import { getJwtInfo } from '../../middleware/jwt';
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
import {
  handleClaimPlatformDelegatedUser,
  handleTransferPlatformDelegatedUser,
} from '../../util/api/users/platforms';
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

router.post('/new/:platform', getOAuthClientInfo(), async (req, res, next) => {
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
  if (req.auth.platform !== platform) {
    throw new ValidationError('AUTH_PLATFORM_NOT_MATCH');
  }
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
        platformUserId = userId;
        isEmailVerified = true;
        autoLinkOAuth = true;
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
      userId: platformUserId,
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

router.post('/edit/:platform', getOAuthClientInfo(), async (req, res, next) => {
  const { platform } = req.params;
  const { user } = req.body;
  if (req.auth.platform !== platform) {
    throw new ValidationError('AUTH_PLATFORM_NOT_MATCH');
  }
  try {
    switch (platform) {
      case 'matters': {
        const {
          action,
          payload,
        } = req.body;
        switch (action) {
          case 'claim': {
            const {
              token,
            } = payload;
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
              toUserToken,
              fromUserToken,
            } = payload;
            const [{
              user: toUserId,
            },
            {
              user: fromUserId,
            }] = await Promise.all([
              getJwtInfo(toUserToken),
              getJwtInfo(fromUserToken),
            ]);
            if (!toUserId || !fromUserId) throw new ValidationError('TOKEN_USER_NOT_FOUND');
            await handleTransferPlatformDelegatedUser(platform, fromUserId, toUserId);
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
