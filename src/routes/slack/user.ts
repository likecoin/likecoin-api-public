import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentFromError,
  getSlackAttachmentFromSubscriptionInfo,
} from '../../util/slack';
import {
  userCollection,
  userAuthCollection,
} from '../../util/firebase';
import { formatUserCivicLikerProperies } from '../../util/api/users';

const router = Router();

async function getUserInfo(req, res, query) {
  let queryType = 'user';
  if (query.includes('@') && query.includes('.')) {
    queryType = 'email';
  } else if (query.startsWith('0x') && query.length === 42) {
    queryType = 'wallet';
  } else if (query.startsWith('cosmos1') && query.length === 45) {
    queryType = 'cosmosWallet';
  } else if (query.startsWith('like1') && query.length === 43) {
    queryType = 'likeWallet';
  }
  let userDoc;
  if (queryType !== 'user') {
    const userQuery = await userCollection.where(queryType, '==', query).limit(1).get();
    if (!userQuery.docs.length) throw new Error('Invalid query, user not found');
    [userDoc] = userQuery.docs;
  } else {
    userDoc = await userCollection.doc(query).get();
    if (!userDoc.exists) {
      // try displayName
      queryType = 'displayName';
      const userQuery = await userCollection.where('displayName', '==', query).limit(1).get();
      if (!userQuery.docs.length) throw new Error('Invalid query, user not found');
      [userDoc] = userQuery.docs;
    }
  }
  const user = userDoc.id;
  const userInfo: any = { user };
  const userData = userDoc.data();
  const civicInfo = formatUserCivicLikerProperies(userDoc);
  Object.assign(userInfo, userData, civicInfo);

  res.json({
    response_type: 'ephemeral',
    attachments: [{
      text: Object.keys(userInfo).map((key) => `${key}: ${userInfo[key]}`).join('\n'),
    }],
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
