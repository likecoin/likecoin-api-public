import axios from 'axios';
import { sha256 } from 'js-sha256';

import {
  FB_PIXEL_ID,
  FB_ACCESS_TOKEN,
} from '../../config/config';

export default async function logPixelEvents(event, {
  email,
  items,
  userAgent,
  clientIp,
  value,
  currency,
  likeWallet,
  paymentId,
  referrer,
  fbClickId,
}: {
  email?: string;
  items: { productId: string; priceIndex?: number; quantity?: number }[];
  userAgent?: string;
  clientIp?: string;
  value: number;
  currency: string;
  likeWallet?: string;
  paymentId?: string;
  referrer?: string;
  fbClickId?: string;
}) {
  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
    return;
  }
  if (!['Purchase', 'InitiateCheckout'].includes(event)) {
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
              external_id: likeWallet ? [sha256(likeWallet)] : undefined,
              fbc: fbClickId,
            },
            custom_data: {
              value,
              currency,
              order_id: paymentId,
              content_type: 'product',
              content_ids: items.map((item) => {
                let id = item.productId;
                if (item.priceIndex !== undefined) {
                  id = `${id}-${item.priceIndex}`;
                }
                return id;
              }),
              contents: items.map((item) => {
                let id = item.productId;
                if (item.priceIndex !== undefined) {
                  id = `${id}-${item.priceIndex}`;
                }
                return {
                  id,
                  quantity: item.quantity || 1,
                };
              }),
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
