import { PostHog } from 'posthog-node';

import {
  POSTHOG_API_KEY,
  POSTHOG_HOST,
} from '../../config/config';
import { SERVER_EVENT_MAP, buildItemId } from './analyticsEvents';
import type { ServerEventName, AnalyticsItem } from './analyticsEvents';

let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!POSTHOG_API_KEY) {
    return null;
  }
  if (!posthogClient) {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST || 'https://us.i.posthog.com',
      flushAt: 10,
      flushInterval: 1000,
    });
  }
  return posthogClient;
}

export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}

export default function logPostHogEvents(event: ServerEventName, {
  evmWallet,
  email,
  items,
  value,
  predictedLTV,
  currency,
  paymentId,
  posthogDistinctId,
  extraProperties,
  setOnce,
}: {
  evmWallet?: string;
  email?: string;
  items?: AnalyticsItem[];
  value?: number;
  predictedLTV?: number;
  currency?: string;
  paymentId?: string;
  posthogDistinctId?: string;
  extraProperties?: Record<string, unknown>;
  setOnce?: Record<string, unknown>;
}) {
  const client = getPostHogClient();
  if (!client) {
    return;
  }
  if (!evmWallet) {
    return;
  }
  const posthogEvent = SERVER_EVENT_MAP[event];
  if (!posthogEvent) {
    // eslint-disable-next-line no-console
    console.warn('logPostHogEvents: event not implemented', event);
    return;
  }
  try {
    // $anon_distinct_id triggers PostHog's implicit person-merge; skip when equal to avoid a no-op.
    const anonDistinctId = posthogDistinctId && posthogDistinctId !== evmWallet
      ? posthogDistinctId
      : undefined;
    client.capture({
      distinctId: evmWallet,
      event: posthogEvent,
      properties: {
        ...extraProperties,
        $set: email ? { email } : undefined,
        $set_once: setOnce && Object.keys(setOnce).length > 0 ? setOnce : undefined,
        $insert_id: paymentId ? `${posthogEvent}_${paymentId}` : undefined,
        $anon_distinct_id: anonDistinctId,
        value,
        predicted_ltv: predictedLTV,
        currency,
        transaction_id: paymentId,
        items: items ? items.map((item) => ({
          id: buildItemId(item.productId, item.priceIndex),
          quantity: item.quantity || 1,
        })) : undefined,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('logPostHogEvents error', error);
  }
}
