import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentForMap,
  getSlackAttachmentFromError,
} from '../../util/slack';
import {
  userCollection,
} from '../../util/firebase';
import { formatUserCivicLikerProperies } from '../../util/api/users';
import { getAuthCoreUserById, getAuthCoreUserContactById, getAuthCoreUserOAuthFactorsById } from '../../util/authcore';
import { authCoreJwtSignToken } from '../../util/jwt';
import {
  findLikerLandWalletUserWithVerifiedEmail,
  fetchLikerLandWalletUserInfo,
} from '../../util/liker-land';
import { getBookUserInfo } from '../../util/api/likernft/book/user';

const router = Router();

async function getUserInfo(req, res, query) {
  let queryType = 'user';
  if (query.includes('@') && query.includes('.')) {
    queryType = 'email';
  } else if (query.startsWith('0x') && query.length === 42) {
    queryType = 'evmWallet';
  } else if (query.startsWith('cosmos1') && query.length === 45) {
    queryType = 'cosmosWallet';
  } else if (query.startsWith('like1') && query.length === 43) {
    queryType = 'likeWallet';
  }

  let userDoc;
  let userInfo: any = {};
  if (queryType !== 'user') {
    const userQuery = await userCollection.where(queryType, '==', query).limit(1).get();
    if (queryType === 'likeWallet' || queryType === 'evmWallet') {
      const bookUser = await getBookUserInfo(query);
      if (bookUser) {
        userInfo.bookInfo = bookUser;
      }
    } else if (!userQuery.docs.length) {
      throw new Error('Invalid query, user not found');
    }
    [userDoc] = userQuery.docs;
  } else {
    const queryDoc = await userCollection.doc(query).get();
    if (queryDoc.exists) {
      userDoc = queryDoc;
    }
  }
  if (userDoc) {
    const user = userDoc.id;
    userInfo = { user, ...userInfo };
    const userData = userDoc.data();
    const {
      evmWallet,
      likeWallet,
    } = userData;
    const walletQuery = evmWallet || likeWallet;
    if (walletQuery && !userInfo.bookInfo) {
      const bookUser = await getBookUserInfo(walletQuery);
      if (bookUser) {
        userInfo.bookInfo = bookUser;
      }
    }
    const civicInfo = formatUserCivicLikerProperies(userDoc);
    if (userData.authCoreUserId) {
      userData.authcoreInfo = {};
      try {
        const authCoreToken = await authCoreJwtSignToken();
        const [authcoreUser, contacts, oAuthFactors] = await Promise.all([
          getAuthCoreUserById(userData.authCoreUserId, authCoreToken),
          getAuthCoreUserContactById(userData.authCoreUserId, authCoreToken),
          getAuthCoreUserOAuthFactorsById(userData.authCoreUserId, authCoreToken),
        ]);
        userData.authcoreInfo.user = authcoreUser;
        userData.authcoreInfo.contacts = contacts
          .map((c) => ({ type: c.type, value: c.value, verified: c.verified }));
        userData.authcoreInfo.oAuthFactors = oAuthFactors
          .map((f) => ({ service: f.service, lastUsedAt: f.lastUsedAt, createdAt: f.createdAt }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }
    Object.assign(userInfo, userData, civicInfo);
  }
  const attachments: Array<ReturnType<typeof getSlackAttachmentForMap>> = [];
  if (userInfo.authcoreInfo) {
    attachments.push(getSlackAttachmentForMap('Authcore Info', userInfo.authcoreInfo));
    delete userInfo.authcoreInfo;
  }
  if (userInfo.civicLiker) {
    attachments.push(getSlackAttachmentForMap('CivicLiker Info', userInfo.civicLiker));
    delete userInfo.civicLiker;
  }
  if (userInfo.likerPlus) {
    attachments.push(getSlackAttachmentForMap('Liker Plus Info', userInfo.likerPlus));
    delete userInfo.likerPlus;
  }
  if (userInfo.bookInfo) {
    attachments.push(getSlackAttachmentForMap('Book Press User Info', userInfo.bookInfo));
    delete userInfo.bookInfo;
  }
  attachments.unshift(getSlackAttachmentForMap('User Info', userInfo));

  res.json({
    response_type: 'ephemeral',
    attachments,
  });
}

router.post(
  '/user',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];
      switch (command) {
        case 'get': {
          if (params.length < 1) {
            throw new Error('Invalid params length. Missing id.');
          }
          await getUserInfo(req, res, params.join(' '));
          break;
        }
        case 'help': {
          res.json({
            response_type: 'ephemeral',
            text: `\`/user get \${liker id}\` Get user info e.g. \`/user get likerid\`
\`/user find \${param} Find user by email/wallet/cosmosWallet e.g. \`/user find team@like.co\``,
          });
          break;
        }
        default:
          throw new Error('Invalid command');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.json({
        response_type: 'ephemeral',
        attachments: [getSlackAttachmentFromError((err as any).message || err)],
      });
    }
  },
);

export default router;
