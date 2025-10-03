export type CartItem = {
  classId?: string
  priceIndex?: number
  customPriceInDecimal?: number
  priceInDecimal?: number
  quantity?: number
  from?: string
}

export type CartItemWithInfo = CartItem & {
  priceInDecimal: number;
  customPriceDiffInDecimal: number;
  stock: number;
  isAllowCustomPrice: boolean;
  name: string,
  description: string,
  images: string[],
  ownerWallet: string,
  isLikerLandArt: boolean;
  originalPriceInDecimal: number,
  classId?: string,
  priceIndex?: number,
  iscnPrefix?: string,
  priceName?: string,
  stripePriceId?: string,
  quantity: number,
  chain: 'like' | 'evm' | 'op' | 'base',
}

export type ItemPriceInfo = {
  quantity: number;
  currency: string;
  priceInDecimal: number;
  customPriceDiffInDecimal: number;
  originalPriceInDecimal: number;
  likerLandTipFeeAmount: number;
  likerLandFeeAmount: number;
  likerLandCommission: number;
  channelCommission: number;
  likerLandArtFee: number;
  classId?: string;
  priceIndex?: number;
  iscnPrefix?: string;
  stripePriceId?: string;
}

export type TransactionFeeInfo = {
  priceInDecimal: number
  originalPriceInDecimal: number
  stripeFeeAmount: number
  likerLandTipFeeAmount: number
  likerLandFeeAmount: number
  likerLandCommission: number
  channelCommission: number
  likerLandArtFee: number
  customPriceDiffInDecimal: number
  royaltyToSplit: number
}
