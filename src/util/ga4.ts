import axios from 'axios';

import {
  GA4_MEASUREMENT_ID,
  GA4_API_SECRET,
} from '../../config/config';
import { SERVER_EVENT_MAP, buildItemId } from './analyticsEvents';
import type { ServerEventName, AnalyticsItem } from './analyticsEvents';

export default async function logGA4Events(event: ServerEventName, {
  gaClientId,
  gaSessionId,
  items,
  value,
  predictedLTV,
  currency,
  paymentId,
}: {
  gaClientId?: string;
  gaSessionId?: string;
  items?: AnalyticsItem[];
  value: number;
  predictedLTV?: number;
  currency: string;
  paymentId?: string;
}) {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    return;
  }
  if (!gaClientId) {
    return;
  }
  const ga4Event = SERVER_EVENT_MAP[event];
  if (!ga4Event) {
    // eslint-disable-next-line no-console
    console.warn('logGA4Events: event not implemented', event);
    return;
  }
  const sessionIdNum = gaSessionId ? parseInt(gaSessionId, 10) : undefined;
  try {
    await axios.post(
      'https://www.google-analytics.com/mp/collect',
      {
        client_id: gaClientId,
        events: [
          {
            name: ga4Event,
            params: {
              session_id: sessionIdNum !== undefined && !Number.isNaN(sessionIdNum)
                ? sessionIdNum
                : undefined,
              transaction_id: paymentId,
              value,
              predicted_ltv: predictedLTV,
              currency,
              items: items ? items.map((item) => ({
                item_id: buildItemId(item.productId, item.priceIndex),
                quantity: item.quantity || 1,
              })) : undefined,
            },
          },
        ],
      },
      {
        params: {
          measurement_id: GA4_MEASUREMENT_ID,
          api_secret: GA4_API_SECRET,
        },
      },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('logGA4Events error', error);
  }
}
