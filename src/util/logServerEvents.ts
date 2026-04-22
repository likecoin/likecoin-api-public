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
    value?: number;
    predictedLTV?: number;
    currency?: string;
    paymentId?: string;
    referrer?: string;
    fbClickId?: string;
    fbp?: string;
    fbc?: string;
    evmWallet?: string;
    gaClientId?: string;
    gaSessionId?: string;
    posthogDistinctId?: string;
    customerType?: 'new' | 'returning';
    extraProperties?: Record<string, unknown>;
    setOnce?: Record<string, unknown>;
  },
): Promise<void> {
  logPostHogEvents(event, options);
  if (options.value == null || options.currency == null) {
    return;
  }
  await Promise.allSettled([
    logPixelEvents(event, options as typeof options & { value: number; currency: string }),
    logGA4Events(event, options as typeof options & { value: number; currency: string }),
  ]);
}
