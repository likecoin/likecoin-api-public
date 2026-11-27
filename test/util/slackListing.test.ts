import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axios from 'axios';

import type { NFTBookComplianceReviewVerdict } from '../../src/types/book';
import type { BookComplianceReviewOutcome } from '../../src/util/api/likernft/book/complianceReview';

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  NFT_BOOK_LISTING_NOTIFICATION_CHANNEL_ID: 'CLISTING',
  NFT_BOOK_LISTING_HELD_MENTION_SLACK_USER_IDS: ['UHELD'],
  PUBLISHING_SLACK_BOT_TOKEN: 'xoxb-test',
}));

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const {
  sendNFTBookNewListingSlackNotification,
  sendNFTBookApprovalUpdateSlackNotification,
} = await import('../../src/util/slack');

const postMock = vi.mocked(axios.post);

const baseParams = {
  wallet: '0xabc',
  classId: '0xclass',
  className: 'Test <!channel> Book',
  prices: [],
};

function verdictOf(
  overrides: Partial<NFTBookComplianceReviewVerdict>,
): BookComplianceReviewOutcome {
  return {
    status: 'completed',
    model: 'test-model',
    verdict: {
      action: 'none',
      hkRisk: 'none',
      adult: false,
      copyrightFlag: false,
      confidence: 'high',
      needsHumanReview: false,
      reason: 'test reason',
      ...overrides,
    },
  };
}

function getPostedMessages() {
  return postMock.mock.calls.map(([url, body, options]) => {
    expect(url).toBe(POST_MESSAGE_URL);
    expect((options as any).headers.Authorization).toBe('Bearer xoxb-test');
    return body as Record<string, string>;
  });
}

describe('listing notifications', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { ok: true, ts: '111.222' } });
  });

  it('posts a clean listing without mentions and threads the details', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({}),
    });
    const [headline, details] = getPostedMessages();
    expect(headline.channel).toBe('CLISTING');
    expect(headline.thread_ts).toBeUndefined();
    expect(headline.text).toMatch(/^✅ Published/);
    expect(headline.text).not.toContain('<@');
    expect(details.thread_ts).toBe('111.222');
    expect(details.text).toContain('*AI Review:*');
  });

  it('mentions reviewers when the AI screen asks for human review', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ needsHumanReview: true }),
    });
    const [headline] = getPostedMessages();
    expect(headline.text).toMatch(/^<@UHELD> 👀 Published, but the AI screen requests human review/);
  });

  it('mentions reviewers on a held listing and keeps the command readable', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ action: 'stop_sale_review' }),
    });
    const [headline] = getPostedMessages();
    expect(headline.text).toMatch(/^<@UHELD> 🚫 Held for review/);
    expect(headline.text).toContain('/book approve 0xclass approve_with_ads|');
  });

  it('escapes the user-supplied book name', async () => {
    await sendNFTBookNewListingSlackNotification({ ...baseParams });
    const [headline] = getPostedMessages();
    expect(headline.text).toContain('Test &lt;!channel&gt; Book');
    expect(headline.text).not.toContain('<!channel>');
  });

  it('skips the thread reply when the headline post fails', async () => {
    postMock.mockResolvedValue({ data: { ok: false, error: 'not_in_channel' } });
    await sendNFTBookNewListingSlackNotification({ ...baseParams });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('logs transport failures without the bot token', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    postMock.mockRejectedValue(Object.assign(new Error('timeout'), {
      code: 'ECONNABORTED',
      config: { headers: { Authorization: 'Bearer xoxb-test' } },
    }));
    await sendNFTBookNewListingSlackNotification({ ...baseParams });
    const logged = consoleError.mock.calls.flat();
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged, Object.getOwnPropertyNames(logged[0]))).not.toContain('xoxb-test');
    expect(String(logged[0])).toContain('ECONNABORTED');
    consoleError.mockRestore();
  });

  // geoblock_hk applies with no human read, so it must always surface for a
  // second look even when the model did not ask for one.
  it('mentions reviewers on a geoblock verdict', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ action: 'geoblock_hk' }),
    });
    const [headline, details] = getPostedMessages();
    expect(headline.text).toMatch(/^<@UHELD> 👀 Published, but the AI screen requests human review/);
    expect(details.text).toContain('👀 Human review requested');
  });

  // The reason is model output over user-supplied metadata,
  // so mention and link syntax must not survive into mrkdwn.
  it('escapes mrkdwn control characters in the verdict reason', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({
        needsHumanReview: true,
        reason: 'Title says <!channel> & <@U123> <http://evil.example|click>',
      }),
    });
    const [, details] = getPostedMessages();
    expect(details.text).toContain('&lt;!channel&gt; &amp; &lt;@U123&gt;');
    expect(details.text).not.toContain('<!channel>');
  });

  it('marks a failed review without mentioning reviewers', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: { status: 'failed' },
    });
    const [headline, details] = getPostedMessages();
    expect(headline.text).toMatch(/^✅ Published/);
    expect(details.text).toContain('⚠️ AI review failed');
  });

  it('posts approval updates through the bot', async () => {
    await sendNFTBookApprovalUpdateSlackNotification({
      classId: '0xclass',
      className: 'Test Book',
      action: 'approve_with_ads',
    });
    const [message] = getPostedMessages();
    expect(message.text).toMatch(/^✅ Approved for Listing & Ads《Test Book》/);
  });
});
