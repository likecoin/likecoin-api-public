import { Router } from 'express';
import { slackTokenChecker, slackCommandHandler } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  formatPlusAffiliateListSlackText,
  getSlackAttachmentForMap,
} from '../../util/slack';
import {
  listPlusAffiliates,
  setUserPlusAffiliate,
  syncUserSubscription,
  linkSubscriptionToUser,
} from '../../util/api/plus/slack';

const router = Router();

router.post(
  '/plus',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  slackCommandHandler({
    sync: async ({ params, res }) => {
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
    },

    link: async ({ params, res }) => {
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
    },

    affiliate: async ({ params, res }) => {
      const [subcommand] = params;
      if (subcommand === 'list') {
        // /plus affiliate list
        const entries = await listPlusAffiliates();
        res.json({
          response_type: 'ephemeral',
          text: formatPlusAffiliateListSlackText(entries),
        });
        return;
      }
      if (subcommand === 'set') {
        // /plus affiliate set <email|userId|wallet> <affiliateUserId>
        if (params.length < 3) {
          throw new Error('Invalid params length. Usage: /plus affiliate set <email|userId|wallet> <affiliateUserId>');
        }
        const result = await setUserPlusAffiliate(params[1], params[2]);
        const voices = result.customVoices
          .map(({ name, language }) => `${name || '(unnamed)'} (${language || '?'})`);
        res.json({
          response_type: 'ephemeral',
          attachments: [getSlackAttachmentForMap('Affiliate Set Result', {
            user: result.user,
            previousPlusAffiliateFrom: result.previousPlusAffiliateFrom || '(none)',
            plusAffiliateFrom: result.plusAffiliateFrom,
            customVoices: voices.length ? voices : '(none)',
          })],
        });
        return;
      }
      throw new Error('Invalid affiliate command. Usage: /plus affiliate <list|set>');
    },

    help: ({ res }) => {
      res.json({
        response_type: 'ephemeral',
        text: `*Plus Legacy Member Management Commands*

\`/plus sync <evmWallet|subscriptionId>\`
Sync a Stripe subscription with proper evmWallet metadata. Can work with either:
- evmWallet (0x...): Find existing subscription for this wallet
- subscriptionId (sub_...): Update subscription metadata with wallet info

\`/plus link <subscriptionId> <evmWallet>\`
Create linkage between a Stripe subscription and an evmWallet.

\`/plus affiliate list\`
List active affiliates with their internal user ID, display name and voice count.

\`/plus affiliate set <email|userId|wallet> <affiliateUserId>\`
Set the user's Plus affiliate, which decides whose custom voices they get. Both user IDs are internal IDs, not handles; the affiliate must have an active config.

*Examples:*
\`/plus sync 0x1234567890abcdef1234567890abcdef12345678\`
\`/plus sync sub_1234567890abcdef\`
\`/plus link sub_1234567890abcdef 0x1234567890abcdef1234567890abcdef12345678\`
\`/plus affiliate list\`
\`/plus affiliate set reader@example.com karen\`
\`/plus affiliate set 0x1234567890abcdef1234567890abcdef12345678 karen\``,
      });
    },
  }, 'Invalid command. Use /plus help for available commands.'),
);

export default router;
