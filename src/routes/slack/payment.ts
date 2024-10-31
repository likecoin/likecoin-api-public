import { Router } from 'express';
import { slackTokenChecker } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  USER_ALLOWED_CHANNEL_IDS,
  USER_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  getSlackAttachmentFromError,
  createPaymentSlackBlocks,
  mapTransactionDocsToSlackSections,
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

        const formattedTransactions = mapTransactionDocsToSlackSections(transactionQuery.docs);
        const blocks = createPaymentSlackBlocks({
          emailOrWallet, transactions: formattedTransactions, classId, collectionId,
        });

        return res.status(200).json({
          response_type: 'ephemeral',
          blocks,
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

      const formattedTransactions = mapTransactionDocsToSlackSections(transactionQuery.docs);
      const blocks = createPaymentSlackBlocks({
        emailOrWallet, transactions: formattedTransactions, status,
      });

      return res.status(200).json({
        response_type: 'ephemeral',
        blocks,
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

        const formattedTransactions = mapTransactionDocsToSlackSections(
          transactionDoc,
        );
        const blocks = createPaymentSlackBlocks({
          transactions: formattedTransactions, cartId,
        });

        return res.status(200).json({
          response_type: 'ephemeral',
          blocks,
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

      const formattedTransactions = mapTransactionDocsToSlackSections(
        transactionDoc,
      );
      const blocks = createPaymentSlackBlocks({
        transactions: formattedTransactions, classId, collectionId, paymentId,
      });

      return res.status(200).json({
        response_type: 'ephemeral',
        blocks,
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

      if (!mainParam && command !== 'help') {
        throw new Error('Invalid query, type help to see the list of available commands');
      }

      let email = '';
      let wallet = '';
      let classId = '';
      let collectionId = '';
      let cartId = '';
      let paymentId = '';
      let status = '';

      if (mainParam) {
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
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*Available Command: `txs`*',
                },
              },
              {
                type: 'divider',
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*Usage 1: General Transaction Search*\n\n`/payment txs {email｜wallet} [classId｜collectionId｜status (optional)]`\n- Find all transactions related to a specific email or wallet.\n- Optionally specify `classId` or `collectionId` to refine the search.\n\n*Example:*\n `/payment txs user@example.com` or `/payment txs like1abcd... classId123`',
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*Usage 2: Specific Transaction Details*\n\n`/payment txs {cartId｜classId+paymentId｜collectionId+paymentId}`\n- Retrieve transaction details for a specific cart, class, or collection item using the `cartId` or `classId/collectionId` along with the `paymentId`.\n\n*Example:*\n `/payment txs cartId123` or `/payment txs classId123 paymentId456`',
                },
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
