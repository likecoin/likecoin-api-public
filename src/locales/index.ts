export const defaultLocale = 'zh';

export const supportedLocales = [
  'en',
  'zh',
] as const;

export type SupportedLocale = typeof supportedLocales[number];

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

export default supportedLocales;
