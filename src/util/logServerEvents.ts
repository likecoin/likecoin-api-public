import logPixelEvents from './fbq';
import logGA4Events from './ga4';
import logPostHogEvents from './posthog';
import type { ServerEventName, AnalyticsItem } from './analyticsEvents';

export type { ServerEventName, AnalyticsItem };

export default async function logServerEvents(
  event: ServerEventName,
  options: {
    email?: string;
    items?: AnalyticsItem[];
    userAgent?: string;
    clientIp?: string;
    value: number;
    predictedLTV?: number;
    currency: string;
    paymentId?: string;
    referrer?: string;
    fbClickId?: string;
    evmWallet?: string;
    gaClientId?: string;
    gaSessionId?: string;
  },
): Promise<void> {
  logPostHogEvents(event, options);
  await Promise.allSettled([
    logPixelEvents(event, options),
    logGA4Events(event, options),
  ]);
}
