export type ServerEventName =
  | 'Purchase'
  | 'InitiateCheckout'
  | 'CompleteRegistration'
  | 'StartTrial'
  | 'Subscribe'
  | 'PlusAcquisition'
  | 'SubscriptionCancelled'
  | 'TrialEnded'
  | 'SubscriptionRenewed'
  | 'PaymentFailed';

export interface AnalyticsItem {
  productId: string;
  priceIndex?: number;
  quantity?: number;
}

export const SERVER_EVENT_MAP: Record<ServerEventName, string> = {
  Purchase: 'purchase',
  InitiateCheckout: 'begin_checkout',
  CompleteRegistration: 'sign_up',
  StartTrial: 'start_trial',
  Subscribe: 'subscribe',
  PlusAcquisition: 'plus_acquisition',
  SubscriptionCancelled: 'subscription_cancelled',
  TrialEnded: 'trial_ended',
  SubscriptionRenewed: 'subscription_renewed',
  PaymentFailed: 'payment_failed',
};

export function buildItemId(productId: string, priceIndex?: number): string {
  return priceIndex !== undefined ? `${productId}-${priceIndex}` : productId;
}
