import { Router } from 'express';
import { slackSignatureChecker } from '../../middleware/slack';
import {
  BOOK_ADMIN_ALLOWED_CHANNEL_IDS,
  BOOK_ADMIN_ALLOWED_USER_IDS,
  PUBLISHING_SLACK_SIGNING_SECRET,
} from '../../../config/config';
import {
  LISTING_REVIEW_ACTIONS,
  LISTING_REVIEW_BLOCK_ID,
  getReviewedListingBlocks,
  postSlackResponseUrl,
} from '../../util/slack';
import { approveBook } from './book';

interface SlackBlockActionsPayload {
  type: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { text?: string; blocks?: { 'block_id'?: string }[] };
  'response_url'?: string;
  actions?: { 'block_id'?: string; value?: string }[];
}

function parseReviewButtonValue(value?: string): { classId?: string; action?: string } {
  try {
    return JSON.parse(value || '');
  } catch {
    return {};
  }
}

async function handleListingReview(payload: SlackBlockActionsPayload) {
  const button = payload.actions?.find((a) => a.block_id === LISTING_REVIEW_BLOCK_ID);
  const { response_url: responseUrl, user, channel } = payload;
  if (payload.type !== 'block_actions' || !button || !responseUrl) return;

  const { classId, action } = parseReviewButtonValue(button.value);
  if (!classId || !action || !LISTING_REVIEW_ACTIONS.includes(action)) return;

  const userId = user?.id;
  const isAllowed = (
    !!userId
    && !!channel?.id
    && BOOK_ADMIN_ALLOWED_CHANNEL_IDS.includes(channel.id)
    && BOOK_ADMIN_ALLOWED_USER_IDS.includes(userId)
  );
  if (!isAllowed) {
    await postSlackResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      replace_original: false,
      text: 'You are not allowed to review book listings.',
    });
    return;
  }

  const originalBlocks = payload.message?.blocks || [];
  const replaceBlocks = (blocks: unknown[]) => postSlackResponseUrl(responseUrl, {
    replace_original: true,
    text: payload.message?.text,
    blocks,
  });
  // Drop the buttons before approving, so another reviewer cannot press one meanwhile
  await replaceBlocks(getReviewedListingBlocks(originalBlocks, {
    userId,
    action,
    reviewedAt: new Date(),
    isDone: false,
  }));
  try {
    await approveBook(classId, action, userId);
  } catch (err) {
    await replaceBlocks(originalBlocks);
    await postSlackResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      replace_original: false,
      text: `Review failed: ${(err as Error).message || err}`,
    });
    return;
  }
  await replaceBlocks(getReviewedListingBlocks(originalBlocks, {
    userId,
    action,
    reviewedAt: new Date(),
  }));
}

const router = Router();

router.post(
  '/interactive',
  slackSignatureChecker(PUBLISHING_SLACK_SIGNING_SECRET),
  (req, res) => {
    let payload: SlackBlockActionsPayload;
    try {
      payload = JSON.parse(req.body.payload);
    } catch {
      res.sendStatus(400);
      return;
    }
    // Slack shows the user an error unless acked within 3s, and approval can take longer
    res.sendStatus(200);
    handleListingReview(payload).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
    });
  },
);

export default router;
