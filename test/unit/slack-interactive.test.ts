import { createHmac } from 'crypto';
import {
  describe, it, expect, vi,
} from 'vitest';
import express from 'express';
import axiosist from 'axiosist';

const SECRET = 'test-signing-secret';
const RESPONSE_URL = 'https://hooks.slack.com/actions/T/1/abc';

vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  PUBLISHING_SLACK_SIGNING_SECRET: 'test-signing-secret',
  BOOK_ADMIN_ALLOWED_CHANNEL_IDS: ['CADMIN'],
  BOOK_ADMIN_ALLOWED_USER_IDS: ['UADMIN'],
}));

vi.mock('../../src/util/slack', async (importOriginal) => ({
  ...(await importOriginal() as object),
  postSlackResponseUrl: vi.fn(),
}));

vi.mock('../../src/routes/slack/book', async (importOriginal) => ({
  ...(await importOriginal() as object),
  approveBook: vi.fn(),
}));

const { default: interactiveRouter } = await import('../../src/routes/slack/interactive');
const { postSlackResponseUrl } = await import('../../src/util/slack');
const { approveBook } = await import('../../src/routes/slack/book');

const responseMock = vi.mocked(postSlackResponseUrl);
const approveMock = vi.mocked(approveBook);

const app = express();
app.use('/slack', interactiveRouter);
const client = axiosist(app);

function reviewPayload({ userId = 'UADMIN', channelId = 'CADMIN', action = 'approve_no_ads' } = {}) {
  return {
    type: 'block_actions',
    user: { id: userId },
    channel: { id: channelId },
    response_url: RESPONSE_URL,
    message: {
      text: 'headline',
      blocks: [
        { type: 'section', block_id: 'headline' },
        { type: 'actions', block_id: 'listing_review' },
      ],
    },
    actions: [{
      block_id: 'listing_review',
      value: JSON.stringify({ classId: '0xclass', action }),
    }],
  };
}

function post(payload: unknown, secret = SECRET) {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  return client.post('/slack/interactive', body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
  });
}

describe('POST /slack/interactive', () => {
  it('rejects a request signed with another secret', async () => {
    const res = await post(reviewPayload(), 'other-secret');
    expect(res.status).toBe(401);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('drops the buttons before approving, then shows the outcome', async () => {
    approveMock.mockImplementationOnce(async () => {
      expect(responseMock).toHaveBeenCalledTimes(1);
      return {} as any;
    });
    const res = await post(reviewPayload());
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(responseMock).toHaveBeenCalledTimes(2));
    expect(approveMock).toHaveBeenCalledWith('0xclass', 'approve_no_ads', 'UADMIN');
    const [[url, pending], [, done]] = responseMock.mock.calls;
    expect(url).toBe(RESPONSE_URL);
    expect((pending.blocks as any[])[1].elements[0].text).toMatch(/^<@UADMIN> ⏳ is running `approve_no_ads`/);
    expect(done.replace_original).toBe(true);
    expect(done.text).toBe('headline');
    const blocks = done.blocks as any[];
    expect(blocks.map((b) => b.block_id)).not.toContain('listing_review');
    expect(blocks[0].block_id).toBe('headline');
    expect(blocks[1].elements[0].text).toMatch(/^<@UADMIN> ran `approve_no_ads` <!date\^\d+\^/);
  });

  it('tells a user outside the allow list and leaves the listing alone', async () => {
    await post(reviewPayload({ userId: 'UOTHER' }));
    await vi.waitFor(() => expect(responseMock).toHaveBeenCalled());
    expect(approveMock).not.toHaveBeenCalled();
    const [, body] = responseMock.mock.calls[0];
    expect(body).toMatchObject({ response_type: 'ephemeral', replace_original: false });
  });

  it('rejects a press from a channel outside the allow list', async () => {
    await post(reviewPayload({ channelId: 'COTHER' }));
    await vi.waitFor(() => expect(responseMock).toHaveBeenCalled());
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('ignores actions the buttons never offer', async () => {
    const res = await post(reviewPayload({ action: 'geoblock' }));
    expect(res.status).toBe(200);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(approveMock).not.toHaveBeenCalled();
    expect(responseMock).not.toHaveBeenCalled();
  });

  it('restores the buttons and reports the error when approval fails', async () => {
    approveMock.mockRejectedValueOnce(new Error('Book class 0xclass not found'));
    await post(reviewPayload());
    await vi.waitFor(() => expect(responseMock).toHaveBeenCalledTimes(3));
    const [, [, restored], [, error]] = responseMock.mock.calls;
    expect((restored.blocks as any[]).map((b) => b.block_id)).toContain('listing_review');
    expect(error).toMatchObject({ response_type: 'ephemeral', replace_original: false });
    expect(error.text).toContain('not found');
  });
});
