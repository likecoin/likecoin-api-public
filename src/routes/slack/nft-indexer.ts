import { Router } from 'express';
import { slackTokenChecker, slackCommandHandler } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import { triggerNFTIndexerUpdate } from '../../util/evm/nft';

const router = Router();

const classIdRegex = /^0x[a-fA-F0-9]{40}$/;

router.post(
  '/indexer',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  slackCommandHandler({
    update: async ({ params, res }) => {
      let classId = '';

      if (params.length > 0) {
        const param = params[0];
        if (classIdRegex.test(param)) {
          classId = param;
        } else {
          throw new Error('Invalid class ID format. Must be a valid EVM contract address (0x...).');
        }
      }

      const result = await triggerNFTIndexerUpdate({ classId });

      const message = classId
        ? `NFT indexer update triggered for class ID: \`${classId}\``
        : 'NFT indexer update triggered for all LikeCoin protocol';

      res.json({
        response_type: 'ephemeral',
        text: `✅ ${message}`,
        attachments: result ? [{
          color: 'good',
          fields: [
            {
              title: 'Response',
              value: JSON.stringify(result, null, 2),
              short: false,
            },
          ],
        }] : [],
      });
    },
    help: ({ res }) => {
      res.json({
        response_type: 'ephemeral',
        text: `*NFT Indexer Commands:*
\`/indexer update\` - Trigger indexer update for entire LikeCoin protocol
\`/indexer update {classId}\` - Trigger indexer update for specific EVM contract

*Examples:*
\`/indexer update\` - Update all
\`/indexer update 0x123abc...\` - Update specific EVM contract address`,
      });
    },
  }, 'Invalid command. Use `/indexer help` for available commands.'),
);

export default router;
