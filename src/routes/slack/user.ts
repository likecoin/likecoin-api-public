import { Router } from 'express';
import { slackTokenChecker, slackCommandHandler } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentForMap,
} from '../../util/slack';
import { findUserDocByQuery, formatUserCivicLikerProperies } from '../../util/api/users';
import { getBookUserInfo } from '../../util/api/likernft/book/user';
import {
  USER_UNLIMITED_UPLOAD_USAGE,
  parseUserUnlimitedUploadQuery,
  setUserUnlimitedSponsoredUpload,
} from '../../util/api/likernft/book/unlimitedUpload';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const router = Router();

async function getUserInfo(req, res, query) {
  const { queryType, userDoc } = await findUserDocByQuery(query);
  let userInfo: any = {};
  if (queryType === 'likeWallet' || queryType === 'evmWallet') {
    const bookUser = await getBookUserInfo(query);
    if (bookUser) {
      userInfo.bookInfo = bookUser;
    }
  } else if (queryType !== 'user' && !userDoc) {
    throw new Error('Invalid query, user not found');
  }
  if (userDoc) {
    const user = userDoc.id;
    userInfo = { user, ...userInfo };
    const userData = userDoc.data();
    if (!userData) throw new Error('USER_DATA_NOT_FOUND');
    const {
      evmWallet,
      likeWallet,
    } = userData;
    const walletQuery = evmWallet || likeWallet;
    if (walletQuery && !userInfo.bookInfo) {
      const bookUser = await getBookUserInfo(walletQuery);
      if (bookUser) {
        userInfo.bookInfo = {
          id: walletQuery,
          ...bookUser,
        };
      }
    }
    const civicInfo = formatUserCivicLikerProperies(userDoc);
    Object.assign(userInfo, userData, civicInfo);
  }
  const attachments: Array<ReturnType<typeof getSlackAttachmentForMap>> = [];
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

const getUserCommand = async ({ params, req, res }) => {
  if (params.length < 1) {
    throw new Error('Invalid params length. Missing id.');
  }
  await getUserInfo(req, res, params.join(' '));
};

router.post(
  '/user',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  slackCommandHandler({
    get: getUserCommand,
    find: getUserCommand,
    'unlimited-upload': async ({ params, req, res }) => {
      const query = parseUserUnlimitedUploadQuery(params);
      const result = await setUserUnlimitedSponsoredUpload(query);
      await publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'BookUserUnlimitedUploadUpdate',
        slackUserId: req.body.user_id,
        ...result,
      });
      res.json({
        response_type: 'ephemeral',
        attachments: [getSlackAttachmentForMap('Unlimited Upload Set Result', result)],
      });
    },
    help: ({ res }) => {
      res.json({
        response_type: 'ephemeral',
        text: `\`/user get \${liker id}\` Get user info e.g. \`/user get likerid\`
\`/user find \${param}\` Find user by email/wallet/cosmosWallet e.g. \`/user find team@like.co\`
\`${USER_UNLIMITED_UPLOAD_USAGE}\` Exempt user's wallet from daily Arweave sponsored upload limits (isUnlimitedSponsoredUpload) e.g. \`/user unlimited-upload team@like.co on\``,
      });
    },
  }),
);

export default router;
