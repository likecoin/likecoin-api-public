import { USD_PRICE_TIER_LIST, HKD_PRICE_TIER_LIST, TWD_PRICE_TIER_LIST } from '../constant/pricing';

export function convertUSDPriceToCurrency(price: number, currency: 'hkd' | 'twd' | 'usd'): number {
  if (price <= 0) {
    return 0;
  }
  switch (currency) {
    case 'hkd': {
      const index = Math.min(Math.round(price), HKD_PRICE_TIER_LIST.length - 1);
      return HKD_PRICE_TIER_LIST[index];
    }
    case 'twd': {
      const index = Math.min(Math.round(price), TWD_PRICE_TIER_LIST.length - 1);
      return TWD_PRICE_TIER_LIST[index];
    }
    case 'usd':
    default:
      return price;
  }
}

export function convertCurrencyToUSDPrice(price: number, currency: 'hkd' | 'twd' | 'usd'): number {
  switch (currency) {
    case 'hkd': {
      const index = HKD_PRICE_TIER_LIST.findIndex((tierPrice) => tierPrice >= price);
      const maxPrice = USD_PRICE_TIER_LIST[USD_PRICE_TIER_LIST.length - 1];
      return index >= 0 ? USD_PRICE_TIER_LIST[index] : maxPrice;
    }
    case 'twd': {
      const index = TWD_PRICE_TIER_LIST.findIndex((tierPrice) => tierPrice >= price);
      const maxPrice = USD_PRICE_TIER_LIST[USD_PRICE_TIER_LIST.length - 1];
      return index >= 0 ? USD_PRICE_TIER_LIST[index] : maxPrice;
    }
    case 'usd':
    default:
      return price;
  }
}
