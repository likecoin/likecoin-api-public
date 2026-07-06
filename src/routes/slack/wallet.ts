import { Router } from 'express';
import { slackTokenChecker, slackCommandHandler } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  WALLET_ALLOWED_CHANNEL_IDS,
  WALLET_ALLOWED_USER_IDS,
  TEAM_WALLET_TABLE, // { [cosmosWallet]: 'Description' }
} from '../../../config/config';
import {
  getCosmosAccountLIKE,
} from '../../util/cosmos';

const router = Router();

router.post(
  '/wallet',
  slackTokenChecker(SLACK_COMMAND_TOKEN, WALLET_ALLOWED_CHANNEL_IDS, WALLET_ALLOWED_USER_IDS),
  slackCommandHandler({
    list: async ({ res }) => {
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
    },
    help: ({ res }) => {
      res.json({
        response_type: 'ephemeral',
        text: '`/wallet list` List team wallets and remaining token',
      });
    },
  }),
);

export default router;
