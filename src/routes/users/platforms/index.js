import { Router } from 'express';
import { PUBSUB_TOPIC_MISC, TEST_MODE } from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
} from '../../../util/firebase';
import {
  tryToUnlinkOAuthLogin,
} from '../../../util/api/users';
import { fetchMattersOAuthInfo, fetchMattersUser } from '../../../util/oauth/matters';
import { createAuthCoreCosmosWalletViaUserToken, updateAuthCoreUserById } from '../../../util/authcore';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth } from '../../../middleware/jwt';
import publisher from '../../../util/gcloudPub';
import { authCoreJwtSignToken, authCoreJwtVerify } from '../../../util/jwt';
import { convertAddressPrefix } from '../../../util/cosmos';

const router = Router();

function checkStateCookie({ req, state, platform }) {
  if (req.cookies[`likeco_login_${platform}`] !== state) {
    throw new ValidationError('INVALID_STATE');
  }
}

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

router.get('/login/:platform', async (req, res, next) => {
  try {
    const { platform } = req.params;
    const { type = 'login' } = req.query;
    let url;
    let state;
    switch (platform) {
      case 'matters': {
        const stateType = type === 'link' ? 'authlink' : 'login';
        ({ url, state } = await fetchMattersOAuthInfo(stateType));
        break;
      }
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }
    res.cookie(`likeco_login_${platform}`, state, { httpOnly: true, secure: !TEST_MODE });
    res.json({ url, state });
  } catch (err) {
    next(err);
  }
});

router.post('/login/:platform', async (req, res, next) => {
  try {
    const { platform } = req.params;
    const { code, state } = req.body;
    let accessToken;
    let email;
    let displayName;
    let avatar;
    checkStateCookie({ req, state, platform });
    switch (platform) {
      case 'matters':
        ({
          accessToken, email, displayName, imageUrl: avatar,
        } = await fetchMattersUser({ code }));
        break;
      default:
        throw new ValidationError('INVALID_PLATFORM');
    }
    res.json({
      accessToken, email, displayName, avatar,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login/:platform/add', jwtAuth('write'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { platform } = req.params;

    let platformUserId;
    switch (platform) {
      case 'authcore': {
        const { idToken, accessToken } = req.body;
        let { cosmosWallet, likeWallet } = req.body;
        if (!idToken) throw new ValidationError('ID_TOKEN_MISSING');
        if (!accessToken) throw new ValidationError('ACCESS_TOKEN_MISSING');
        const authCoreUser = authCoreJwtVerify(idToken);
        const {
          sub: authCoreUserId,
          email,
          email_verified: isEmailVerified,
          // TODO: update displayname after authcore fix default name privacy issue
          // name: displayName,
        } = authCoreUser;
        if (!cosmosWallet) {
          cosmosWallet = await createAuthCoreCosmosWalletViaUserToken(accessToken);
        }
        if (!likeWallet && cosmosWallet) {
          likeWallet = convertAddressPrefix(cosmosWallet, 'like');
        }
        const [userQuery, emailQuery, walletQuery, likeWalletQuery] = await Promise.all([
          dbRef.where('authCoreUserId', '==', authCoreUserId).get(),
          dbRef.where('email', '==', email).get(),
          dbRef.where('cosmosWallet', '==', cosmosWallet).get(),
          dbRef.where('likeWallet', '==', likeWallet).get(),
        ]);
        if (userQuery.docs.length > 0) {
          userQuery.forEach((doc) => {
            const docUser = doc.id;
            if (user !== docUser) {
              throw new ValidationError('AUTHCORE_USER_DUPLICATED');
            }
          });
        }
        if (emailQuery.docs.length > 0) {
          emailQuery.forEach((doc) => {
            const docUser = doc.id;
            if (user !== docUser) {
              throw new ValidationError('AUTHCORUE_EMAIL_DUPLICATED');
            }
          });
        }
        if (walletQuery.docs.length > 0) {
          walletQuery.forEach((doc) => {
            const docUser = doc.id;
            if (user !== docUser) {
              throw new ValidationError('AUTHCORUE_WALLET_DUPLICATED');
            }
          });
        }
        if (likeWalletQuery.docs.length > 0) {
          likeWalletQuery.forEach((doc) => {
            const docUser = doc.id;
            if (user !== docUser) {
              throw new ValidationError('AUTHCORUE_WALLET_DUPLICATED');
            }
          });
        }
        await dbRef.doc(user).update({
          authCoreUserId,
          cosmosWallet,
          likeWallet,
          email,
          isEmailVerified,
          // TODO: update displayname after authcore fix default name privacy issue
          // displayName,
        });
        await authDbRef.doc(user).set({ authcore: { userId: authCoreUserId } }, { merge: true });
        try {
          const authCoreToken = await authCoreJwtSignToken();
          await updateAuthCoreUserById(
            authCoreUserId,
            {
              user,
              displayName: user,
            },
            authCoreToken,
          );
        } catch (err) {
          /* no update will return 400 error */
          if (!err.response || err.response.status !== 400) console.error(err);
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
