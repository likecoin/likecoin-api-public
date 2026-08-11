import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axios from 'axios';

import { BOOK3_HOSTNAME } from '../../src/constant';

const WEBHOOK_URL = 'https://hooks.slack.test/plus';

// Only override the Plus webhook so the notification is not skipped; the rest of
// the real config still loads for the other modules slack.ts pulls in.
vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK: WEBHOOK_URL,
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const { sendPlusSubscriptionSlackNotification } = await import('../../src/util/slack');

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
