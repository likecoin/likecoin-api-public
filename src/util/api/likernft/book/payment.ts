import { FieldValue } from '../../../firebase';

export type BookPaymentGiftInfo = {
  toName: string,
  toEmail: string,
  fromName: string,
  message?: string,
};

export function buildBasePaymentPayload({
  type,
  email = '',
  claimToken,
  sessionId = '',
  from = '',
  priceInDecimal,
  originalPriceInDecimal,
  coupon,
  ipCountry,
  giftInfo,
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  from?: string;
  priceInDecimal: number;
  originalPriceInDecimal: number;
  coupon?: string;
  ipCountry?: string;
  giftInfo?: BookPaymentGiftInfo;
}) {
  const payload: any = {
    type,
    email,
    isPaid: false,
    isPendingClaim: false,
    claimToken,
    sessionId,
    from,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
    price: priceInDecimal / 100,
    priceInDecimal,
    originalPriceInDecimal,
  };
  if (coupon) payload.coupon = coupon;
  if (ipCountry) payload.ipCountry = ipCountry;
  if (giftInfo) {
    const {
      toEmail = '',
      toName = '',
      fromName = '',
      message = '',
    } = giftInfo;
    payload.isGift = true;
    payload.giftInfo = {
      toEmail,
      toName,
      fromName,
      message,
    };
  }
  return payload;
}
