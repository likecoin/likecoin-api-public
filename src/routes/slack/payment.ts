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

async function handleTxsQuery({
  email, wallet, classId, collectionId, status, cartId, paymentId, res,
}) {
  try {
    if (email || wallet) {
      const queryType = email ? 'email' : 'wallet';
      const emailOrWallet = email || wallet;

      // Search in book or collection
      if (classId || collectionId) {
        const bookRef = classId ? likeNFTBookCollection.doc(classId)
          : likeNFTCollectionCollection.doc(collectionId);
        const transactionQuery = await bookRef
          .collection('transactions')
          .where(queryType, '==', emailOrWallet)
          .orderBy('timestamp', 'desc')
          .limit(10)
          .get();
        const formattedTransactions = mapTransactionDocsToSlackFields(transactionQuery.docs);
        const attachments = createPaymentSlackAttachments(
          { transactions: formattedTransactions, emailOrWallet, classId },
        );

        return res.status(200).json({
          response_type: 'ephemeral',
          attachments,
        });
      }
      // Search in cart collection
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

    if (cartId || classId || collectionId) {
      if (cartId) {
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
      // search by classId | collection + paymentId
      if (!paymentId) {
        throw new Error('Invalid query, paymentId is required');
      }
      const bookRef = classId ? likeNFTBookCollection.doc(classId)
        : likeNFTCollectionCollection.doc(collectionId);
      const transactionDoc = await bookRef
        .collection('transactions')
        .doc(paymentId)
        .get();

      if (!transactionDoc.exists) {
        throw new Error(`Transaction with paymentId: ${paymentId} not found in ${collectionId}`);
      }
      const transactionQuery = transactionDoc.data();
      const attachment = createStatusSlackAttachments(
        { transaction: transactionQuery, classId, paymentId },
      );

      return res.status(200).json({
        response_type: 'ephemeral',
        attachments: attachment,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching transactions:', error);
    return res.status(400).json({ message: 'Error fetching transactions' });
  }
  return null;
}

router.post(
  '/payment',
  slackTokenChecker(SLACK_COMMAND_TOKEN, USER_ALLOWED_CHANNEL_IDS, USER_ALLOWED_USER_IDS),
  async (req, res) => {
    try {
      const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];
      const [mainParam, additionalFilter] = params;

      if (!mainParam) {
        throw new Error('Invalid query, type help to see the list of available commands');
      }

      let email = '';
      let wallet = '';
      let classId = '';
      let collectionId = '';
      let cartId = '';
      let paymentId = '';
      let status = '';

      if (mainParam.includes('@') && mainParam.includes('.')) {
        email = mainParam;
      } else if (mainParam.startsWith('like1') && mainParam.length === 43) {
        wallet = mainParam;
      } else if (classIdRegex.test(mainParam)) {
        classId = mainParam;
      } else if (mainParam.includes('col_book')) {
        collectionId = mainParam;
      } else if (paymentIdRegex.test(mainParam)) {
        cartId = mainParam;
      }

      if (additionalFilter) {
        if (classIdRegex.test(additionalFilter)) {
          classId = additionalFilter;
        } else if (additionalFilter.includes('col_book')) {
          collectionId = additionalFilter;
        } else if (paymentIdRegex.test(additionalFilter)) {
          paymentId = additionalFilter;
        } else if (Object.values(PAYMENT_STATUS).includes(mainParam)) {
          status = mainParam;
        }
      }

      switch (command) {
        case 'txs':
          return await handleTxsQuery({
            email, wallet, classId, collectionId, status, cartId, paymentId, res,
          });
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
