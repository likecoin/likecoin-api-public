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

// Currencies whose book price can be overridden away from the ladder. USD is
// excluded by design: it is the stored `priceInDecimal` and the commission base.
export const BOOK_PRICE_OVERRIDE_CURRENCIES = ['hkd', 'twd'] as const;

/**
 * Resolves the charge amount (in minor units, e.g. cents) for a given currency.
 *
 * USD always uses the stored `usdPriceInDecimal` (the commission base). For
 * HKD/TWD, an explicit per-book override on the price tier takes precedence
 * over the index-based ladder conversion; this is how operations can offer a
 * bespoke off-ladder TWD price without polluting the global price ladder.
 */
export function getCurrencyPriceInDecimal(
  usdPriceInDecimal: number,
  currency: SupportedPlusCurrency,
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency,
): number {
  if (currency === 'usd') return usdPriceInDecimal;
  const override = priceInDecimalByCurrency?.[currency];
  if (typeof override === 'number' && override > 0) return override;
  return convertUSDPriceToCurrency(usdPriceInDecimal / 100, currency) * 100;
}

/**
 * Builds the Stripe `currency_options` block for a book price, honouring any
 * per-currency override. Centralised so product creation, price updates and
 * inline checkout line items stay consistent.
 */
export function getStripeCurrencyOptionsFromNFTBookPrice(
  usdPriceInDecimal: number,
  priceInDecimalByCurrency?: BookPriceInDecimalByCurrency,
) {
  return {
    twd: {
      unit_amount: getCurrencyPriceInDecimal(usdPriceInDecimal, 'twd', priceInDecimalByCurrency),
    },
    hkd: {
      unit_amount: getCurrencyPriceInDecimal(usdPriceInDecimal, 'hkd', priceInDecimalByCurrency),
    },
  };
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
