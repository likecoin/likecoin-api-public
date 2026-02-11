export const defaultLocale = 'zh';

export const supportedLocales = [
  'en',
  'zh',
] as const;

export type SupportedLocale = typeof supportedLocales[number];

export default supportedLocales;
