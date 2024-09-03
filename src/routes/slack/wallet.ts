import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  WALLET_ALLOWED_CHANNEL_IDS,
  WALLET_ALLOWED_USER_IDS,
  TEAM_WALLET_TABLE, // { [cosmosWallet]: 'Description' }
} from '../../../config/config';
import {
  getCosmosAccountLIKE,
} from '../../util/cosmos';
import {
  getSlackAttachmentFromError,
} from '../../util/slack';

const router = Router();

router.post(
  '/wallet',
  slackTokenChecker(SLACK_COMMAND_TOKEN, WALLET_ALLOWED_CHANNEL_IDS, WALLET_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];
      switch (command) {
        case 'list': {
          const cosmosWallets = Object.keys(TEAM_WALLET_TABLE);
          const promises = cosmosWallets.map((d) => getCosmosAccountLIKE(d));
          const amounts = await Promise.all(promises);
          const fields: any[] = [];
          for (let i = 0; i < amounts.length; i += 1) {
            const cosmosWallet = cosmosWallets[i];
            fields.push({
              title: TEAM_WALLET_TABLE[cosmosWallet],
              value: `${amounts[i]} (${cosmosWallet})`,
              short: false,
            });
          }
          res.json({
            response_type: 'in_channel',
            attachments: [
              { fields },
            ],
          });
          break;
        }
        case 'help': {
          res.json({
            response_type: 'ephemeral',
            text: '`/wallet list` List team wallets and remaining token',
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
