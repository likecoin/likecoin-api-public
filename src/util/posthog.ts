import { PostHog } from 'posthog-node';
import uuidv5 from 'uuid/v5';

import {
  POSTHOG_API_KEY,
  POSTHOG_HOST,
} from '../../config/config';
import { SERVER_EVENT_MAP, buildItemId } from './analyticsEvents';
import type { ServerEventName, AnalyticsItem } from './analyticsEvents';

// Browser fires the same business events (purchase, start_trial, subscribe, begin_checkout)
// from the corresponding success page in liker-land-v3. Both sides build the same URL
// string and hash it under RFC 4122 NAMESPACE_URL to get a deterministic uuidv5, which is
// passed as the event uuid. PostHog's ClickHouse dedup tuple (timestamp, distinct_id,
// event, uuid) then collapses the pair into one row. The matching helper lives in
// liker-land-v3/composables/use-logger.ts; the URL format below is the contract.
//
// The uuid is derived from the POST-MAPPING event name (`posthogEvent`, see capture call
// below), NOT the internal `ServerEventName`. The browser passes the raw PostHog event
// name (e.g. 'subscribe'), so we must match that side. Renaming a SERVER_EVENT_MAP value
// without updating the browser would silently break dedup.
const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 appendix C

// The host must be a fixed literal: substituting BOOK3_HOSTNAME or any other env-aware
// hostname constant would flip between testnet/mainnet and silently break dedup.
function derivePostHogEventUUID(eventName: string, transactionId: string): string {
  return uuidv5(`https://3ook.com/posthog-dedup/${eventName}/${transactionId}`, NAMESPACE_URL);
}

function nonEmpty(properties?: Record<string, unknown>): Record<string, unknown> | undefined {
  return properties && Object.keys(properties).length > 0 ? properties : undefined;
}

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
  likeWallet,
  email,
  items,
  value,
  predictedLTV,
  currency,
  paymentId,
  posthogDistinctId,
  extraProperties,
  setOnce,
  set,
}: {
  evmWallet?: string;
  likeWallet?: string;
  email?: string;
  items?: AnalyticsItem[];
  value?: number;
  predictedLTV?: number;
  currency?: string;
  paymentId?: string;
  posthogDistinctId?: string;
  extraProperties?: Record<string, unknown>;
  setOnce?: Record<string, unknown>;
  set?: Record<string, unknown>;
}) {
  const client = getPostHogClient();
  if (!client) {
    return;
  }
  // Legacy likeWallet-only users (Cosmos-era, no evmWallet) must still be counted;
  // callers with neither wallet may pass a synthetic posthogDistinctId (e.g. `stripe:<customer>`).
  const distinctId = evmWallet || likeWallet || posthogDistinctId;
  if (!distinctId) {
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
    const anonDistinctId = posthogDistinctId && posthogDistinctId !== distinctId
      ? posthogDistinctId
      : undefined;
    // The browser stamps the same person props on every identify (liker-land-v3
    // composables/use-logger.ts), but it never sees a lifecycle change the user
    // isn't present for — so subscription callers write them from here too.
    const personProperties = { ...(email ? { email } : {}), ...set };
    client.capture({
      distinctId,
      event: posthogEvent,
      uuid: typeof paymentId === 'string' && paymentId
        ? derivePostHogEventUUID(posthogEvent, paymentId)
        : undefined,
      properties: {
        ...extraProperties,
        $set: nonEmpty(personProperties),
        $set_once: nonEmpty(setOnce),
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
