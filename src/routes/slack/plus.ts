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
  syncUserSubscription,
  linkSubscriptionToUser,
} from '../../util/api/plus/slack';

const router = Router();

router.post(
  '/plus',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];

      switch (command) {
        case 'sync': {
          // /plus sync <evmWallet|subscriptionId>
          if (params.length < 1) {
            throw new Error('Invalid params length. Usage: /plus sync <evmWallet|subscriptionId>');
          }

          const param = params[0];
          let data = {};

          if (param.startsWith('sub_')) {
            // It's a subscription ID
            data = { subscriptionId: param };
          } else if (param.startsWith('0x') && param.length === 42) {
            // It's an EVM wallet
            data = { evmWallet: param };
          } else {
            throw new Error('Invalid parameter. Must be either an evmWallet (0x...) or subscriptionId (sub_...)');
          }

          const result = await syncUserSubscription(data);

          const attachments = [
            getSlackAttachmentForMap('Sync Result', result),
          ];

          res.json({
            response_type: 'ephemeral',
            attachments,
          });
          break;
        }

        case 'link': {
          // /plus link <subscriptionId> <evmWallet>
          if (params.length < 2) {
            throw new Error('Invalid params length. Usage: /plus link <subscriptionId> <evmWallet>');
          }

          const subscriptionId = params[0];
          const evmWallet = params[1];

          if (!subscriptionId.startsWith('sub_')) {
            throw new Error('Invalid subscription ID format. Must start with "sub_"');
          }

          if (!evmWallet.startsWith('0x') || evmWallet.length !== 42) {
            throw new Error('Invalid EVM wallet format. Must be 42 characters starting with "0x"');
          }

          const result = await linkSubscriptionToUser(subscriptionId, evmWallet);

          const attachments = [
            getSlackAttachmentForMap('Link Result', result),
          ];

          res.json({
            response_type: 'ephemeral',
            attachments,
          });
          break;
        }

        case 'help': {
          res.json({
            response_type: 'ephemeral',
            text: `*Plus Legacy Member Management Commands*

\`/plus sync <evmWallet|subscriptionId>\`
Sync a Stripe subscription with proper evmWallet metadata. Can work with either:
- evmWallet (0x...): Find existing subscription for this wallet
- subscriptionId (sub_...): Update subscription metadata with wallet info

\`/plus link <subscriptionId> <evmWallet>\`
Create linkage between a Stripe subscription and an evmWallet.

*Examples:*
\`/plus sync 0x1234567890abcdef1234567890abcdef12345678\`
\`/plus sync sub_1234567890abcdef\`
\`/plus link sub_1234567890abcdef 0x1234567890abcdef1234567890abcdef12345678\``,
          });
          break;
        }

        default:
          throw new Error('Invalid command. Use /plus help for available commands.');
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
