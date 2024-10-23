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
  likeNFTBookCollection,
  likeNFTBookCartCollection,
} from '../../util/firebase';

const router = Router();

const PAYMENT_STATUS = {
  NEW: 'new',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  PAID: 'paid', // auto delivered
};

function convertFirestoreTimestamp(timestamp) {
  // eslint-disable-next-line no-underscore-dangle
  if (!timestamp || !timestamp._seconds) {
    return 'No timestamp';
  }

  // eslint-disable-next-line no-underscore-dangle
  const date = new Date(timestamp._seconds * 1000 + timestamp._nanoseconds / 1000000);
  return date;
}

function formatTransactionForSlack(data) {
  const {
    timestamp, id: paymentId, classId, classIds, sessionId, claimToken, from, isAutoDeliver,
    priceInDecimal: price, isPaid, status, email, wallet,
  } = data;

  const formattedTimestamp = convertFirestoreTimestamp(timestamp).toLocaleString();
  const displayClassId = classId || classIds; // 顯示 classId 或 classIds

  return `*Timestamp:* ${formattedTimestamp}\n`
         + `*Payment ID:* ${paymentId}\n`
         + `*Class ID:* ${displayClassId}\n`
         + `*Session ID:* ${sessionId}\n`
         + `*Claim Token:* ${claimToken}\n`
         + `*From:* ${from}\n`
         + `*Is Auto Deliver:* ${isAutoDeliver ? 'Yes' : 'No'}\n`
         + `*Price:* $${price}\n`
         + `*Is Paid:* ${isPaid ? 'Yes' : 'No'}\n`
         + `*Status:* ${status}\n`
         + `*Email:* ${email}\n`
         + `${wallet ? `*Wallet:* ${wallet}\n` : ''}`;
}

// eslint-disable-next-line consistent-return
async function handleTxsQuery(params, res) {
  const [emailOrWallet, statusOrClassId] = params;

  if (!emailOrWallet) {
    throw new Error('Invalid query, email or wallet not found');
  }

  let queryType = '';
  if (emailOrWallet.includes('@') && emailOrWallet.includes('.')) {
    queryType = 'email';
  } else if (emailOrWallet.startsWith('like1') && emailOrWallet.length === 43) {
    queryType = 'wallet';
  } else {
    throw new Error('Invalid query, email or wallet format incorrect');
  }

  const classIdRegex = /^likenft1[ac-hj-np-z02-9]+$/;
  let status = null;
  let classId = null;

  if (statusOrClassId) {
    if (classIdRegex.test(statusOrClassId)) {
      classId = statusOrClassId;
    } else if (Object.values(PAYMENT_STATUS).includes(statusOrClassId)) {
      status = statusOrClassId;
    } else {
      throw new Error('Invalid query, status or classId not found');
    }
  }

  try {
    if (classId) {
      const transactionQuery = await likeNFTBookCollection
        .doc(classId)
        .collection('transactions')
        .where(queryType, '==', emailOrWallet)
        .orderBy('timestamp', 'desc')
        .get();

      const transactions = transactionQuery.docs.map((doc) => formatTransactionForSlack({
        ...doc.data(),
        id: doc.id,
      }));
      const attachments: any = [{
        text: `Transactions for ${emailOrWallet} in class ${classId}`,
      }];
      attachments.push(getSlackAttachmentForMap('Search Result:', transactions));

      res.status(200).json({
        response_type: 'ephemeral',
        attachments,
      });
    } else {
      const query = likeNFTBookCartCollection
        .where(queryType, '==', emailOrWallet);

      if (status) {
        query.where('status', '==', status);
      } else {
        query.where('status', '!=', 'new');
      }

      const transactionQuery = await query.limit(10).get();
      const transactions = transactionQuery.docs.map((doc) => formatTransactionForSlack({
        ...doc.data(),
        id: doc.id,
      }));

      const attachments: any = [{
        text: `Transactions for ${emailOrWallet} in cart collection`,
      }];
      attachments.push(getSlackAttachmentForMap('Search Result:', transactions));

      return res.status(200).json({
        response_type: 'ephemeral',
        attachments,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching transactions:', error);
    return res.status(400).json({ message: 'Error fetching transactions' });
  }
}

router.post(
  '/payment',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];
      switch (command) {
        case 'txs':
          return await handleTxsQuery(params, res);
        // case 'status':
        //   return await handleStatusQuery(params, res);
        case 'help': {
          res.json({
            response_type: 'ephemeral',
            attachments: [
              {
                pretext: '*Available Commands*',
                color: '#36a64f',
                text: "*`/payment txs {email｜wallet} [classId/status (option)]`*\nFind all transactions related to the provided email or wallet.\n\nOptionally filter by status:\n- 'new'\n- 'completed'\n- 'cancelled'\n- 'pending'\n- 'paid'\n\n*Example:*\n`/payment txs user@example.com completed`",
                mrkdwn_in: ['text', 'pretext'],
              },
              {
                color: '#36a64f',
                text: '*`/payment status {cartId｜classId + paymentId}`*\nCheck the status of a specific payment.\n\n*Example:*\n`/payment status 7a60b8-XXX`\nor\n`/payment status likenft1XXX 7a60b8-XXX`',
                mrkdwn_in: ['text'],
              },
            ],
          });
          break;
        }
        default:
          throw new Error('Invalid command. Please use `/payment help` to see the list of valid commands.');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.json({
        response_type: 'ephemeral',
        attachments: [getSlackAttachmentFromError((err as any).message || err)],
      });
    }
    return null;
  },
);

export default router;
