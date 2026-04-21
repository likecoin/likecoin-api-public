import axios from 'axios';
import { sha256 } from 'js-sha256';
import { sha256 as viemSHA256 } from 'viem';

import {
  FB_PIXEL_ID,
  FB_ACCESS_TOKEN,
} from '../../config/config';
import { SERVER_EVENT_MAP, buildItemId } from './analyticsEvents';
import type { ServerEventName, AnalyticsItem } from './analyticsEvents';

function formatFbc(fbClickId?: string, fbc?: string): string | undefined {
  if (fbc) return fbc;
  if (!fbClickId) return undefined;
  return `fb.1.${Date.now()}.${fbClickId}`;
}

export default async function logPixelEvents(event: ServerEventName, {
  email,
  items,
  userAgent,
  clientIp,
  value,
  predictedLTV,
  currency,
  paymentId,
  referrer,
  fbClickId,
  fbp,
  fbc,
  evmWallet,
  customerType,
}: {
  email?: string;
  items?: AnalyticsItem[];
  userAgent?: string;
  clientIp?: string;
  value: number;
  predictedLTV?: number;
  currency: string;
  likeWallet?: string;
  paymentId?: string;
  referrer?: string;
  fbClickId?: string;
  fbp?: string;
  fbc?: string;
  evmWallet?: string;
  customerType?: 'new' | 'returning';
}) {
  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
    return;
  }
  if (!SERVER_EVENT_MAP[event]) {
    // eslint-disable-next-line no-console
    console.warn('logPixelEvents: event not implemented', event);
    return;
  }
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${FB_PIXEL_ID}/events`,
      {
        data: [
          {
            event_name: event,
            event_id: paymentId ? `${event}_${paymentId}` : undefined,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            referrer_url: referrer,
            user_data: {
              em: email ? [sha256(email)] : undefined,
              client_user_agent: userAgent,
              client_ip_address: clientIp,
              external_id: evmWallet && evmWallet.startsWith('0x')
                ? [viemSHA256(evmWallet as `0x${string}`)]
                : undefined,
              fbc: formatFbc(fbClickId, fbc),
              fbp,
            },
            custom_data: {
              value,
              predicted_ltv: predictedLTV,
              currency,
              order_id: paymentId,
              customer_type: customerType,
              content_type: 'product',
              content_ids: items
                ? items.map((item) => buildItemId(item.productId, item.priceIndex))
                : undefined,
              contents: items ? items.map((item) => ({
                id: buildItemId(item.productId, item.priceIndex),
                quantity: item.quantity || 1,
              })) : undefined,
            },
          },
        ],
      },
      {
        params: {
          access_token: FB_ACCESS_TOKEN,
        },
      },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('logPixelEvents error', error);
  }
}
