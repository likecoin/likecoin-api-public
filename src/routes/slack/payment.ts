import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentFromError,
  createPaymentSlackAttachments,
  mapTransactionDocsToSlackFields,
  createStatusSlackAttachments,
} from '../../util/slack';
import {
  likeNFTBookCollection,
  likeNFTBookCartCollection,
  likeNFTCollectionCollection,
} from '../../util/firebase';

const router = Router();

const PAYMENT_STATUS = {
  NEW: 'new',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  PAID: 'paid', // auto delivered
};

const classIdRegex = /^likenft1[ac-hj-np-z02-9]+$/;
const paymentIdRegex = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

// eslint-disable-next-line consistent-return
async function handleTxsQuery(params, res) {
  const [emailOrWallet, additionalFilter] = params;

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

  let status = null;
  let classId = null;
  let collectionId = null;

  if (additionalFilter) {
    if (classIdRegex.test(additionalFilter)) {
      classId = additionalFilter;
    } else if (Object.values(PAYMENT_STATUS).includes(additionalFilter)) {
      status = additionalFilter;
    } else if (additionalFilter.includes('col_book')) {
      collectionId = additionalFilter;
    } else {
      throw new Error('Invalid option query, status or classId not found');
    }
  }

  try {
    if (classId) {
      const transactionQuery = await likeNFTBookCollection
        .doc(classId)
        .collection('transactions')
        .where(queryType, '==', emailOrWallet)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();
      const formattedTransactions = mapTransactionDocsToSlackFields(transactionQuery.docs);
      const attachments = createPaymentSlackAttachments(
        { transactions: formattedTransactions, emailOrWallet, classId },
      );

      res.status(200).json({
        response_type: 'ephemeral',
        attachments,
      });
    } else if (collectionId) {
      const transactionQuery = await likeNFTCollectionCollection
        .doc(collectionId)
        .collection('transactions')
        .where(queryType, '==', emailOrWallet)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();
      const formattedTransactions = mapTransactionDocsToSlackFields(transactionQuery.docs);
      const attachments = createPaymentSlackAttachments(
        { transactions: formattedTransactions, emailOrWallet, collectionId },
      );

      res.status(200).json({
        response_type: 'ephemeral',
        attachments,
      });
    } else { // search in cart collection
      const query = likeNFTBookCartCollection
        .where(queryType, '==', emailOrWallet);

      if (status) {
        query.where('status', '==', status);
      } else {
        query.where('status', '!=', 'new');
      }

      const transactionQuery = await query.orderBy('timestamp', 'desc').limit(10).get();
      const formattedTransactions = mapTransactionDocsToSlackFields(transactionQuery.docs);
      const attachments = createPaymentSlackAttachments(
        { transactions: formattedTransactions, emailOrWallet },
      );

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

// eslint-disable-next-line consistent-return
async function handleStatusQuery(params, res) {
  const [classIdOrCartId, paymentId] = params;

  let classId = null;
  let cartId = null;

  if (classIdRegex.test(classIdOrCartId)) {
    classId = classIdOrCartId;
    if (!paymentId) {
      throw new Error('Invalid query, paymentId not found');
    } else if (!paymentIdRegex.test(paymentId)) {
      throw new Error('Invalid query, paymentId format incorrect');
    }
  } else if (paymentIdRegex.test(classIdOrCartId)) {
    cartId = classIdOrCartId;
  }

  try {
    if (classId) {
      const transactionDoc = await likeNFTBookCollection
        .doc(classId)
        .collection('transactions')
        .doc(paymentId)
        .get();

      if (!transactionDoc.exists) {
        throw new Error(`Transaction with paymentId: ${paymentId} not found in class: ${classId}`);
      }

      const transactionQuery = transactionDoc.data();
      const attachment = createStatusSlackAttachments(
        { transaction: transactionQuery, classId, paymentId },
      );

      return res.status(200).json({
        response_type: 'ephemeral',
        attachments: attachment,
      });
    } if (cartId) {
      const transactionDoc = await likeNFTBookCartCollection
        .doc(cartId)
        .get();

      if (!transactionDoc.exists) {
        throw new Error(`Transaction with cartId: ${cartId} not found`);
      }

      const transactionQuery = transactionDoc.data();
      const attachment = createStatusSlackAttachments(
        { transaction: transactionQuery, paymentId: cartId },
      );

      return res.status(200).json({
        response_type: 'ephemeral',
        attachments: attachment,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching transactions:', error);
    throw new Error('Failed to fetch payment status');
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
        case 'status':
          return await handleStatusQuery(params, res);
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
