import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axios from 'axios';

import { BOOK3_HOSTNAME } from '../../src/constant';
import type { NFTBookComplianceReviewVerdict } from '../../src/types/book';
import type { BookComplianceReviewOutcome } from '../../src/util/api/likernft/book/complianceReview';

const WEBHOOK_URL = 'https://hooks.slack.test/plus';
const LISTING_WEBHOOK_URL = 'https://hooks.slack.test/listing';

// Only override the webhooks so the notifications are not skipped; the rest of
// the real config still loads for the other modules slack.ts pulls in.
vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK: WEBHOOK_URL,
  NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK: LISTING_WEBHOOK_URL,
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const {
  sendPlusSubscriptionSlackNotification,
  sendNFTBookNewListingSlackNotification,
} = await import('../../src/util/slack');

const postMock = vi.mocked(axios.post);

function getPostedPayload() {
  expect(postMock).toHaveBeenCalledTimes(1);
  const [url, payload] = postMock.mock.calls[0];
  expect(url).toBe(WEBHOOK_URL);
  return payload as Record<string, unknown>;
}

describe('sendPlusSubscriptionSlackNotification', () => {
  beforeEach(() => {
    postMock.mockClear();
  });

  it('links a Stripe subscription to its dashboard pages', async () => {
    await sendPlusSubscriptionSlackNotification({
      subscriptionId: 'sub_123',
      email: 'test@example.com',
      priceWithCurrency: '4.99 USD',
      isNew: true,
      userId: 'liker1',
      stripeCustomerId: 'cus_123',
      method: 'stripe',
    });
    const payload = getPostedPayload();
    expect(payload.subscriptionLink).toContain('/subscriptions/sub_123');
    expect(payload.customerLink).toContain('/customers/cus_123');
    expect(payload.method).toBe('Stripe');
  });

  it.each([
    ['revenuecat' as const, 'https://app.revenuecat.com/'],
    ['shared' as const, `https://${BOOK3_HOSTNAME}/store/@liker1`],
  ])('links a %s subscription to a usable page', async (method, expectedLink) => {
    await sendPlusSubscriptionSlackNotification({
      subscriptionId: 'txn_123',
      email: 'test@example.com',
      priceWithCurrency: '4.99 USD',
      isNew: true,
      userId: 'liker1',
      method,
    });
    const payload = getPostedPayload();
    expect(payload.subscriptionLink).toBe(expectedLink);
    expect(payload.customerLink).toBe(`https://${BOOK3_HOSTNAME}/store/@liker1`);
    expect(payload.customerId).toBe('N/A');
  });

  // The Slack message turns the links into buttons, which reject an empty URL,
  // and JSON.stringify drops undefined keys before axios ever sends them.
  it.each(['stripe', 'revenuecat', 'shared'] as const)('sends every link key for %s', async (method) => {
    await sendPlusSubscriptionSlackNotification({
      subscriptionId: 'txn_123',
      email: 'test@example.com',
      priceWithCurrency: '4.99 USD',
      isNew: true,
      userId: 'liker1',
      method,
    });
    const serialised = JSON.parse(JSON.stringify(getPostedPayload()));
    ['subscriptionLink', 'customerLink'].forEach((key) => {
      expect(serialised).toHaveProperty(key);
      expect(() => new URL(serialised[key])).not.toThrow();
    });
  });
});

describe('sendNFTBookNewListingSlackNotification AI review rendering', () => {
  beforeEach(() => {
    postMock.mockClear();
  });

  const baseParams = {
    wallet: '0xabc',
    classId: '0xclass',
    className: 'Test Book',
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

  function getListingPayload() {
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, payload] = postMock.mock.calls[0];
    expect(url).toBe(LISTING_WEBHOOK_URL);
    return payload as Record<string, string>;
  }

  it('renders a clean verdict without a review ping', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({}),
    });
    const payload = getListingPayload();
    expect(payload.aiReview).not.toContain('👀');
    expect(payload.approvalStatus).toBe('⏳ Pending Approval');
  });

  // geoblock_hk applies with no human read, so it must always surface for a
  // second look even when the model did not ask for one.
  it('always pings on a geoblock verdict', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ action: 'geoblock_hk' }),
    });
    const payload = getListingPayload();
    expect(payload.aiReview).toContain('👀 Human review requested');
    expect(payload.approvalStatus).toContain('requests human review');
    expect(payload.approvalStatus).toContain('test reason');
  });

  it('pings when the verdict asks for human review', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ needsHumanReview: true }),
    });
    const payload = getListingPayload();
    expect(payload.aiReview).toContain('👀 Human review requested');
    expect(payload.approvalStatus).toContain('requests human review');
  });

  it('renders a held listing as a release request, not a ping', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({ action: 'stop_sale_review' }),
    });
    const payload = getListingPayload();
    expect(payload.approvalStatus).toContain('🚫 Held for review');
    expect(payload.approvalStatus).toContain('/book approve 0xclass');
  });

  // The reason is model output over user-supplied metadata, and Slack parses
  // mrkdwn in workflow variables, so mention/link syntax must not survive.
  it('escapes mrkdwn control characters in the verdict reason', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: verdictOf({
        needsHumanReview: true,
        reason: 'Title says <!channel> & <@U123> <http://evil.example|click>',
      }),
    });
    const payload = getListingPayload();
    for (const field of [payload.aiReview, payload.approvalStatus]) {
      expect(field).not.toContain('<');
      expect(field).not.toContain('>');
      expect(field).toContain('&lt;!channel&gt; &amp; &lt;@U123&gt;');
    }
  });

  it('marks a failed review and keeps the default status', async () => {
    await sendNFTBookNewListingSlackNotification({
      ...baseParams,
      aiReview: { status: 'failed' },
    });
    const payload = getListingPayload();
    expect(payload.aiReview).toContain('⚠️ AI review failed');
    expect(payload.approvalStatus).toBe('⏳ Pending Approval');
  });
});
