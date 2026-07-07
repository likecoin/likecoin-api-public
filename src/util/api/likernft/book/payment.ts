import { FieldValue } from '../../../firebase';
import { ValidationError } from '../../../ValidationError';
import type { ItemPriceInfo, TransactionFeeInfo } from './type';

export type BookPaymentGiftInfo = {
  toName: string,
  toEmail: string,
  fromName: string,
  message?: string,
};

// Validate the token before leaking any claim state, so callers with an
// invalid token only ever see INVALID_CLAIM_TOKEN.
export function assertClaimable(
  docData: {
    claimToken?: string;
    status?: string;
    wallet?: string;
  },
  { token, wallet }: { token: string; wallet: string },
  errorPrefix: 'PAYMENT' | 'CART',
): void {
  const {
    claimToken,
    status,
    wallet: claimedWallet,
  } = docData;

  if (token !== claimToken) {
    throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
  }

  if (claimedWallet && claimedWallet !== wallet) {
    throw new ValidationError(`${errorPrefix}_ALREADY_CLAIMED_BY_OTHER`, 403);
  }

  if (status !== 'paid') {
    if (claimedWallet) {
      throw new ValidationError(`${errorPrefix}_ALREADY_CLAIMED_BY_WALLET`, 409);
    }
    throw new ValidationError(`${errorPrefix}_ALREADY_CLAIMED`, 403);
  }
}

export function calculateItemFeeInfo(item: ItemPriceInfo, {
  totalStripeFeeAmount,
  totalPriceInDecimal,
}: {
  totalStripeFeeAmount: number;
  totalPriceInDecimal: number;
}): TransactionFeeInfo {
  const {
    quantity,
    priceInDecimal,
    customPriceDiffInDecimal,
    originalPriceInDecimal,
    likerLandTipFeeAmount,
    likerLandFeeAmount,
    likerLandCommission,
    channelCommission,
    likerLandArtFee,
  } = item;
  const stripeFeeAmount = (totalStripeFeeAmount > 0 && totalPriceInDecimal > 0)
    ? Math.ceil((totalStripeFeeAmount * priceInDecimal * quantity) / totalPriceInDecimal)
    : 0;
  return {
    stripeFeeAmount,
    priceInDecimal: priceInDecimal * quantity,
    originalPriceInDecimal: originalPriceInDecimal * quantity,
    customPriceDiffInDecimal: customPriceDiffInDecimal * quantity,
    likerLandTipFeeAmount: likerLandTipFeeAmount * quantity,
    likerLandFeeAmount: likerLandFeeAmount * quantity,
    likerLandCommission: likerLandCommission * quantity,
    channelCommission: channelCommission * quantity,
    likerLandArtFee: likerLandArtFee * quantity,
    // stripeFeeAmount is prorated for the whole line (already includes quantity),
    // so subtract it once from the line total, not from the per-unit price.
    royaltyToSplit: Math.max(
      (priceInDecimal
      - likerLandFeeAmount
      - likerLandTipFeeAmount
      - likerLandCommission
      - channelCommission
      - likerLandArtFee) * quantity
      - stripeFeeAmount,
      0,
    ),
  };
}

export function sumFeeInfo(itemFeeInfos: TransactionFeeInfo[]): TransactionFeeInfo {
  return itemFeeInfos.reduce(
    (acc, item) => ({
      priceInDecimal: acc.priceInDecimal + item.priceInDecimal,
      originalPriceInDecimal: acc.originalPriceInDecimal + item.originalPriceInDecimal,
      stripeFeeAmount: acc.stripeFeeAmount + item.stripeFeeAmount,
      likerLandTipFeeAmount: acc.likerLandTipFeeAmount + item.likerLandTipFeeAmount,
      likerLandFeeAmount: acc.likerLandFeeAmount + item.likerLandFeeAmount,
      likerLandCommission: acc.likerLandCommission + item.likerLandCommission,
      channelCommission: acc.channelCommission + item.channelCommission,
      likerLandArtFee: acc.likerLandArtFee + item.likerLandArtFee,
      customPriceDiffInDecimal: acc.customPriceDiffInDecimal + item.customPriceDiffInDecimal,
      royaltyToSplit: acc.royaltyToSplit + item.royaltyToSplit,
    }),
    {
      priceInDecimal: 0,
      originalPriceInDecimal: 0,
      stripeFeeAmount: 0,
      likerLandTipFeeAmount: 0,
      likerLandFeeAmount: 0,
      likerLandCommission: 0,
      channelCommission: 0,
      likerLandArtFee: 0,
      customPriceDiffInDecimal: 0,
      royaltyToSplit: 0,
    },
  );
}

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
