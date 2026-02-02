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

export function checkIsFromLikerLand(from: string): boolean {
  return from === NFT_BOOK_DEFAULT_FROM_CHANNEL;
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
      const likerLandFeeAmount = isFree ? 0 : Math.ceil(
        originalPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandTipFeeAmount = Math.ceil(
        customPriceDiffInDecimal * NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
      );
      const channelCommission = (from && !isCommissionWaived && !isFromLikerLand && !isFree)
        ? Math.max(Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ), 0)
        : 0;
      const likerLandCommission = (isFromLikerLand && !isFree)
        ? Math.max(Math.ceil(
          originalPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO - priceDiscountInDecimal,
        ), 0)
        : 0;
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
