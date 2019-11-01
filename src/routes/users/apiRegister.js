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
  handlePlatformOAuthBind,
} from '../../util/api/users/platforms';
import { createAuthCoreUserAndWallet } from '../../util/api/users/authcore';
import { fetchMattersUser } from '../../util/oauth/matters';
import { checkUserNameValid } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import publisher from '../../util/gcloudPub';

const router = Router();

router.post('/new/check', async (req, res, next) => {
  try {
    const {
      user,
    } = req.body;
    let { email } = req.body;
    try {
      if (email) email = handleEmailBlackList(email);
      if (!checkUserNameValid(user)) {
        throw new ValidationError('INVALID_USER_NAME');
      }
      await checkUserInfoUniqueness({
        user,
        email,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        const payload = { error: err.message };
        if (err.message === 'USER_ALREADY_EXIST' || err.message === 'INVALID_USER_NAME') {
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
  try {
    if (req.auth.platform !== platform) {
      throw new ValidationError('AUTH_PLATFORM_NOT_MATCH');
    }
    let platformUserId;
    let platformAccessToken;
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
        platformAccessToken = token;
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
        accessToken: platformAccessToken,
      },
      res,
      req,
      isPlatformDelegated: autoLinkOAuth,
    });
    await createAuthCoreUserAndWallet(
      {
        user,
        email,
        displayName,
      },
      [{ platform, platformUserId }],
    );

    let accessToken;
    let refreshToken;
    let scope;
    let jwtid;
    if (autoLinkOAuth) {
      ({
        jwtid,
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
      accessToken: jwtid,
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
  if (req.auth.platform !== platform) {
    throw new ValidationError('AUTH_PLATFORM_NOT_MATCH');
  }
  let user;
  let action;
  try {
    switch (platform) {
      case 'matters': {
        const {
          payload,
        } = req.body;
        if (!payload) throw new Error('PLATFORM_PAYLOAD_NOT_FOUND');
        ({
          action,
        } = req.body);
        switch (action) {
          case 'claim': {
            const {
              platformToken,
              token, // token is deprecated
            } = payload;
            user = req.body.payload.user || req.body.user; // body is deprecated
            const {
              userId,
              email,
              displayName,
            } = await fetchMattersUser({ accessToken: platformToken || token });
            const isEmailVerified = true;
            await handleClaimPlatformDelegatedUser(platform, user, {
              email,
              displayName,
              isEmailVerified,
            });
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventClaimMattersDelegatedUser',
              platform,
              mattersUserId: userId,
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
              getJwtInfo(toUserToken)
                .catch((err) => {
                  if (err.name === 'TokenExpiredError') {
                    throw new ValidationError('FROM_USER_TOKEN_EXPIRED');
                  }
                  throw err;
                }),
              getJwtInfo(fromUserToken)
                .catch((err) => {
                  if (err.name === 'TokenExpiredError') {
                    throw new ValidationError('FROM_USER_TOKEN_EXPIRED');
                  }
                  throw err;
                }),
            ]);
            if (!toUserId || !fromUserId) throw new ValidationError('TOKEN_USER_NOT_FOUND');
            if (toUserId === fromUserId) throw new ValidationError('FROM_TO_SAME_USER');
            const {
              pendingLIKE,
            } = await handleTransferPlatformDelegatedUser(platform, fromUserId, toUserId);
            const {
              jwtid,
              accessToken,
              refreshToken,
              scope,
            } = await autoGenerateUserTokenForClient(req, platform, toUserId);
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventTransferMattersDelegatedUser',
              platform,
              toUserId,
              fromUserId,
              pendingLIKE,
              jwtid,
            });
            res.json({
              accessToken,
              refreshToken,
              scope,
            });
            break;
          }
          case 'bind': {
            const {
              platformToken,
              userToken,
            } = payload;
            ({ user } = await getJwtInfo(userToken)
              .catch((err) => {
                if (err.name === 'TokenExpiredError') {
                  throw new ValidationError('USER_TOKEN_EXPIRED');
                }
                throw err;
              }));
            if (!user) throw new ValidationError('TOKEN_USER_NOT_FOUND');
            const {
              userId,
              displayName,
            } = await handlePlatformOAuthBind(platform, user, platformToken);
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'eventMattersBindUser',
              platform,
              mattersUserId: userId,
              mattersDisplayName: displayName,
              user,
            });
            res.sendStatus(200);
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
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventAPIUserRegisterPlatformEditError',
      user,
      platform,
      action,
      error: err.message || JSON.stringify(err),
    });
    next(err);
  }
});

export default router;
