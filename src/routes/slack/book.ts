import { Router } from 'express';
import { slackTokenChecker, slackCommandHandler } from '../../middleware/slack';
import {
  SLACK_COMMAND_TOKEN,
  BOOK_ADMIN_ALLOWED_CHANNEL_IDS,
  BOOK_ADMIN_ALLOWED_USER_IDS,
} from '../../../config/config';
import {
  sendNFTBookApprovalUpdateSlackNotification,
} from '../../util/slack';
import { FieldValue, likeNFTBookCollection } from '../../util/firebase';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { updateAirtablePublicationRecord } from '../../util/airtable';

const router = Router();

const BOOK_APPROVAL_ACTIONS = [
  'approve_with_ads', 'approve_no_ads', 'approve_hidden', 'pending_review', 'reject', 'clear_geoblock',
];
const BOOK_APPROVAL_USAGE = `<${BOOK_APPROVAL_ACTIONS.join('|')}>`;

async function approveBook(classId: string, action: string, slackUserId: string) {
  const bookDoc = await likeNFTBookCollection.doc(classId).get();

  if (!bookDoc.exists) {
    throw new Error(`Book class ${classId} not found`);
  }

  const bookData = bookDoc.data();
  const className = bookData?.name || classId;
  const { isAdultOnly } = bookData || {};

  // Recovery lever for a territory restriction applied by the AI pre-screen or
  // a batch run: clears restrictedTerritories without touching the approval
  // flags. No Airtable mirror — restrictedTerritories has no Airtable column.
  if (action === 'clear_geoblock') {
    await likeNFTBookCollection.doc(classId).update({
      restrictedTerritories: FieldValue.delete(),
    });
    await Promise.all([
      publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'BookNFTApprovalUpdate',
        slackUserId,
        classId,
        action,
      }),
      sendNFTBookApprovalUpdateSlackNotification({
        classId,
        className,
        action,
      }),
    ]);
    // approvalStatus is display-only here; the stored field is untouched.
    return { classId, className, approvalStatus: 'geoblock_cleared' };
  }

  let approvalUpdate: any = {};

  switch (action) {
    case 'pending_review':
      approvalUpdate = {
        isPendingReview: true,
        isApprovedForSale: false,
        isApprovedForIndexing: false,
        isApprovedForAds: false,
        approvalStatus: 'pending_review',
      };
      break;
    case 'approve_with_ads':
      approvalUpdate = {
        isPendingReview: false,
        isHidden: false,
        isApprovedForSale: true,
        isApprovedForIndexing: true,
        isApprovedForAds: !isAdultOnly,
        approvalStatus: 'approved',
      };
      break;
    case 'approve_no_ads':
      approvalUpdate = {
        isPendingReview: false,
        isHidden: false,
        isApprovedForSale: true,
        isApprovedForIndexing: true,
        isApprovedForAds: false,
        approvalStatus: 'approved_no_ads',
      };
      break;
    case 'approve_hidden':
      approvalUpdate = {
        isPendingReview: false,
        isHidden: true,
        isApprovedForSale: true,
        isApprovedForIndexing: false,
        isApprovedForAds: false,
        approvalStatus: 'approved_hidden',
      };
      break;
    case 'reject':
      approvalUpdate = {
        isPendingReview: false,
        isHidden: true,
        isApprovedForSale: false,
        isApprovedForIndexing: false,
        isApprovedForAds: false,
        approvalStatus: 'rejected',
      };
      break;
    default:
      throw new Error(`Invalid approval action: ${action}`);
  }

  await likeNFTBookCollection.doc(classId).update(approvalUpdate);
  await updateAirtablePublicationRecord({
    id: classId,
    isHidden: approvalUpdate.isHidden,
    isPendingReview: approvalUpdate.isPendingReview,
  });

  await Promise.all([
    publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'BookNFTApprovalUpdate',
      slackUserId,
      classId,
      action,
      ...approvalUpdate,
    }),
    sendNFTBookApprovalUpdateSlackNotification({
      classId,
      className,
      action,
    }),
  ]);

  return {
    classId,
    className,
    ...approvalUpdate,
  };
}

router.post(
  '/book',
  slackTokenChecker(
    SLACK_COMMAND_TOKEN,
    BOOK_ADMIN_ALLOWED_CHANNEL_IDS,
    BOOK_ADMIN_ALLOWED_USER_IDS,
  ),
  slackCommandHandler({
    approve: async ({ params, req, res }) => {
      const slackUserId = req.body.user_id;
      const [classId, action = 'approve_with_ads'] = params;
      if (!classId) {
        throw new Error(`Missing classId. Usage: /book approve <classId> ${BOOK_APPROVAL_USAGE}`);
      }
      if (!BOOK_APPROVAL_ACTIONS.includes(action)) {
        throw new Error(`Invalid action. Must be one of ${BOOK_APPROVAL_ACTIONS.join(', ')}`);
      }
      const result = await approveBook(classId, action, slackUserId);

      res.json({
        response_type: 'in_channel',
        text: `Book approval updated for *${result.className}*\nClass ID: \`${result.classId}\`\nStatus: \`${result.approvalStatus}\``,
      });
    },
    help: ({ res }) => {
      res.json({
        response_type: 'ephemeral',
        text: `\`/book approve <classId> ${BOOK_APPROVAL_USAGE}\` Approve or reject a book listing

Examples:
  \`/book approve 0x1234...5678 \` - Approve for listing & ads (default)
  \`/book approve 0x1234...5678  approve_with_ads\` - Approve for listing & ads
  \`/book approve 0x1234...5678  approve_no_ads\` - Approve for listing (no ads)
  \`/book approve 0x1234...5678  approve_hidden\` - Approve but keep hidden (no ads)
  \`/book approve 0x1234...5678  pending_review\` - Hold for review; 404 to public until approved
  \`/book approve 0x1234...5678  reject\` - Reject/hide listing
  \`/book approve 0x1234...5678  clear_geoblock\` - Remove territory restriction (approval flags untouched)`,
      });
    },
  }, 'Invalid command. Use `/book help` for usage.'),
);

export default router;
