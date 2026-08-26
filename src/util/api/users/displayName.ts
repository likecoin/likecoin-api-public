import {
  DISPLAY_NAME_PLACES_ZH,
  DISPLAY_NAME_PLACES_EN,
  DISPLAY_NAME_NATURE_ZH,
  DISPLAY_NAME_NATURE_EN,
} from '../../../constant/displayName';
import { legacyLocales } from '../../../locales';

// Markets that get a Traditional Chinese name. Narrower than the frontend's
// locale map, which also sends CN, SG and MY to Chinese: the Chinese pool is
// Hong Kong and Taiwan districts, which only read as local names here.
const ZH_DISPLAY_NAME_COUNTRIES = new Set(['HK', 'TW', 'MO']);

const ZH_DISPLAY_NAME_LOCALES = new Set<string>(['zh', ...legacyLocales]);

export interface DisplayNameLocaleInput {
  ipCountry?: string;
  locale?: string;
}

function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Callers must pass the locale as the client sent it, not the defaulted one:
 * `defaultLocale` is 'zh', so a defaulted value would hand every locale-less
 * caller a Chinese name.
 */
export function shouldUseZhDisplayName({ ipCountry, locale }: DisplayNameLocaleInput): boolean {
  if (ipCountry) return ZH_DISPLAY_NAME_COUNTRIES.has(ipCountry.toUpperCase());
  return !!locale && ZH_DISPLAY_NAME_LOCALES.has(locale.toLowerCase());
}

/**
 * Display names are not keyed on anywhere, so collisions between the ~79k
 * combinations per locale are harmless and go unchecked.
 */
export function getRandomDisplayName(input: DisplayNameLocaleInput = {}): string {
  if (shouldUseZhDisplayName(input)) {
    return `${pickRandom(DISPLAY_NAME_PLACES_ZH)}的${pickRandom(DISPLAY_NAME_NATURE_ZH)}`;
  }
  return `${pickRandom(DISPLAY_NAME_PLACES_EN)}'s ${pickRandom(DISPLAY_NAME_NATURE_EN)}`;
}
