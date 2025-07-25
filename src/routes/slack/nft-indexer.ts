import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentFromError,
} from '../../util/slack';
import { triggerNFTIndexerUpdate } from '../../util/evm/nft';

const router = Router();

const classIdRegex = /^0x[a-fA-F0-9]{40}$/;

router.post(
  '/indexer',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];

      switch (command) {
        case 'update': {
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
          break;
        }
        case 'help': {
          res.json({
            response_type: 'ephemeral',
            text: `*NFT Indexer Commands:*
\`/indexer update\` - Trigger indexer update for entire LikeCoin protocol
\`/indexer update {classId}\` - Trigger indexer update for specific EVM contract

*Examples:*
\`/indexer update\` - Update all
\`/indexer update 0x123abc...\` - Update specific EVM contract address`,
          });
          break;
        }
        default:
          throw new Error('Invalid command. Use `/indexer help` for available commands.');
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
