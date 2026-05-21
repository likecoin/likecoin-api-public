import { USD_PRICE_TIER_LIST, HKD_PRICE_TIER_LIST, TWD_PRICE_TIER_LIST } from '../constant/pricing';
import type { SupportedPlusCurrency } from '../constant';
import type { BookPriceInDecimalByCurrency } from '../types/book';

const MAX_USD = USD_PRICE_TIER_LIST[USD_PRICE_TIER_LIST.length - 1]!;
const MAX_HKD = HKD_PRICE_TIER_LIST[HKD_PRICE_TIER_LIST.length - 1]!;
const MAX_TWD = TWD_PRICE_TIER_LIST[TWD_PRICE_TIER_LIST.length - 1]!;

export function convertUSDPriceToCurrency(price: number, currency: SupportedPlusCurrency): number {
  if (price <= 0) {
    return 0;
  }
  switch (currency) {
    case 'hkd': {
      if (price > MAX_USD) {
        return Math.floor(price * (MAX_HKD / MAX_USD));
      }
      const index = Math.min(Math.round(price), HKD_PRICE_TIER_LIST.length - 1);
      return HKD_PRICE_TIER_LIST[index];
    }
    case 'twd': {
      if (price > MAX_USD) {
        return Math.floor(price * (MAX_TWD / MAX_USD));
      }
      const index = Math.min(Math.round(price), TWD_PRICE_TIER_LIST.length - 1);
      return TWD_PRICE_TIER_LIST[index];
    }
    case 'usd':
    default:
      return price;
  }
}

// USD is excluded by design: it is the stored `priceInDecimal` and the commission base.
export const BOOK_PRICE_OVERRIDE_CURRENCIES = ['hkd', 'twd'] as const;

export function getCurrencyPriceInDecimal(
  usdPriceInDecimal: number,
  currency: SupportedPlusCurrency,
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency,
): number {
  if (currency === 'usd') return usdPriceInDecimal;
  const override = priceInDecimalByCurrency?.[currency];
  if (typeof override === 'number') return override;
  return convertUSDPriceToCurrency(usdPriceInDecimal / 100, currency) * 100;
}

export function getStripeCurrencyOptionsFromNFTBookPrice(
  usdPriceInDecimal: number,
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency,
) {
  return Object.fromEntries(
    BOOK_PRICE_OVERRIDE_CURRENCIES.map((currency) => {
      const unitAmount = getCurrencyPriceInDecimal(
        usdPriceInDecimal,
        currency,
        priceInDecimalByCurrency,
      );
      return [currency, { unit_amount: unitAmount }];
    }),
  );
}

type OverrideCurrency = typeof BOOK_PRICE_OVERRIDE_CURRENCIES[number];

type BookPriceLike = {
  priceInDecimal: number;
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency;
};

export function getBookPriceRangeByCurrency(
  prices: BookPriceLike[],
): Record<OverrideCurrency, { min: number; max: number }> {
  const result = {} as Record<OverrideCurrency, { min: number; max: number }>;
  for (const currency of BOOK_PRICE_OVERRIDE_CURRENCIES) {
    const amounts = prices.map((p) => getCurrencyPriceInDecimal(
      p.priceInDecimal,
      currency,
      p.priceInDecimalByCurrency,
    ));
    const min = amounts.reduce((acc, v) => Math.min(acc, v), Infinity) / 100;
    const max = amounts.reduce((acc, v) => Math.max(acc, v), 0) / 100;
    result[currency] = { min, max };
  }
  return result;
}

export function convertCurrencyToUSDPrice(price: number, currency: SupportedPlusCurrency): number {
  switch (currency) {
    case 'hkd': {
      if (price > MAX_HKD) {
        return Math.floor(price * (MAX_USD / MAX_HKD));
      }
      const index = HKD_PRICE_TIER_LIST.findIndex((tierPrice) => tierPrice >= price);
      return index >= 0 ? USD_PRICE_TIER_LIST[index] : MAX_USD;
    }
    case 'twd': {
      if (price > MAX_TWD) {
        return Math.floor(price * (MAX_USD / MAX_TWD));
      }
      const index = TWD_PRICE_TIER_LIST.findIndex((tierPrice) => tierPrice >= price);
      return index >= 0 ? USD_PRICE_TIER_LIST[index] : MAX_USD;
    }
    case 'usd':
    default:
      return price;
  }
}
