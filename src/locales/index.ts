export const defaultLocale = 'zh';

export const supportedLocales = [
  'en',
  'zh',
] as const;

// Locales that may appear in stored data but are no longer offered as input.
// 'cn' is the pre-rename code for Chinese (now 'zh') still present on legacy docs.
export const legacyLocales = [
  'cn',
] as const;

// Superset of every locale code that can appear in persisted data. Use this for
// response schemas/types; keep `supportedLocales` for validating new input.
export const storedLocales = [
  ...supportedLocales,
  ...legacyLocales,
] as const;

export type StoredLocale = typeof storedLocales[number];

// First supported candidate wins; non-string and legacy codes fall through.
export function resolveLocale(...candidates: unknown[]): string {
  return candidates.find(
    (l): l is string => typeof l === 'string' && (supportedLocales as readonly string[]).includes(l),
  ) || defaultLocale;
}

export default supportedLocales;
