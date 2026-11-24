import {
  LIKER_LAND_WAIVED_CHANNEL,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
} from '../../../../constant';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
} from '../../../../../config/config';
import { CartItemWithInfo, ItemPriceInfo } from './type';
import { isNonNFTProduct } from '.';

export function checkIsFromLikerLand(from: string): boolean {
  return from === NFT_BOOK_DEFAULT_FROM_CHANNEL;
}

// Admin-set ratios are arbitrary decimals: 200000 * 0.3148 is 62960.00000000001,
// which a bare ceil would round up a whole cent.
function ceilByRatio(amount: number, ratio: number): number {
  return Math.ceil(Math.round(amount * ratio * 1e6) / 1e6);
}

export function calculateItemPrices(items: CartItemWithInfo[], from?: string): ItemPriceInfo[] {
  const itemPrices: ItemPriceInfo[] = items.map(
    (item) => {
      const isFromLikerLand = checkIsFromLikerLand(item.from || from || '');
      const isFree = !item.priceInDecimal && !item.customPriceDiffInDecimal;
      const isCommissionWaived = from === LIKER_LAND_WAIVED_CHANNEL;
      const customPriceDiffInDecimal = item.customPriceDiffInDecimal || 0;
      const { priceInDecimal, originalPriceInDecimal } = item;
      const priceInDecimalWithoutTip = priceInDecimal - customPriceDiffInDecimal;
      const priceDiscountInDecimal = Math.max(
        originalPriceInDecimal - priceInDecimalWithoutTip,
        0,
      );
      const isNonNFT = isNonNFTProduct(item);
      // Merch takes no coupons, so only the member price discounts it and skips the platform fee.
      // Flagged, not inferred: settlement converts the charge to USD, off the USD list price.
      const isFeeWaived = isFree || (isNonNFT && !!item.isPlusPrice);
      const likerLandFeeAmount = isFeeWaived ? 0 : Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      let channelCommission = 0;
      let likerLandCommission = 0;
      const { platformCommissionRatio, channelCommissionRatio } = item;
      const isCommissionByRatio = (
        isNonNFT
        || platformCommissionRatio !== undefined
        || channelCommissionRatio !== undefined
      );
      if (isCommissionByRatio) {
        // Admin-set ratios replace the default book commission and are merch's only one,
        // taken on the price paid: a member price or coupon must not cut the commission again.
        // Gated on the item's own channel, which settlement pays the affiliate by.
        const itemFrom = item.from || from;
        const isItemCommissionWaived = itemFrom === LIKER_LAND_WAIVED_CHANNEL;
        if (!isItemCommissionWaived && !isFree) {
          likerLandCommission = ceilByRatio(priceInDecimalWithoutTip, platformCommissionRatio || 0);
          if (itemFrom && !isFromLikerLand) {
            channelCommission = ceilByRatio(priceInDecimalWithoutTip, channelCommissionRatio || 0);
          }
        }
      } else {
        const commission = Math.max(Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ), 0);
        if (from && !isCommissionWaived && !isFromLikerLand && !isFree) {
          channelCommission = commission;
        }
        if (isFromLikerLand && !isFree) likerLandCommission = commission;
      }
      const likerLandArtFee = (item.isLikerLandArt && !isFree)
        ? Math.ceil(originalPriceInDecimal * NFT_BOOK_LIKER_LAND_ART_FEE_RATIO)
        : 0;

      const payload: ItemPriceInfo = {
        quantity: item.quantity,
        currency: 'usd',
        priceInDecimal,
        customPriceDiffInDecimal,
        originalPriceInDecimal,
        likerLandTipFeeAmount,
        likerLandFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      };
      if (item.classId) payload.classId = item.classId;
      if (item.priceIndex !== undefined) payload.priceIndex = item.priceIndex;
      if (item.stripePriceId) payload.stripePriceId = item.stripePriceId;
      return payload;
    },
  );
  return itemPrices;
}
