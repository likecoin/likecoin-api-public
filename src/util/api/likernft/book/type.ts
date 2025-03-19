export type CartItem = {
  collectionId?: string
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
  hasShipping: boolean;
  isPhysicalOnly: boolean;
  isAllowCustomPrice: boolean;
  name: string,
  description: string,
  images: string[],
  ownerWallet: string,
  shippingRates: any[],
  isLikerLandArt: boolean;
  originalPriceInDecimal: number,
  collectionId?: string,
  classId?: string,
  priceIndex?: number,
  iscnPrefix?: string,
  priceName?: string,
  stripePriceId?: string,
  quantity: number,
}
