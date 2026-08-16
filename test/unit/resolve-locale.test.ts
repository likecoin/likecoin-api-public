import { describe, it, expect } from 'vitest';
import { resolveLocale } from '../../src/locales';

// Callers pass request-supplied values that zod only checks as strings, alongside
// stored locales that may hold legacy codes, so falling through to the next
// candidate rather than straight to the default is the behaviour they rely on.
describe('resolveLocale', () => {
  it('takes the first supported candidate', () => {
    expect(resolveLocale('en', 'zh')).toBe('en');
    expect(resolveLocale('zh', 'en')).toBe('zh');
  });

  it('falls through unsupported candidates instead of failing to the default', () => {
    expect(resolveLocale('en-US', 'en')).toBe('en');
    expect(resolveLocale('cn', 'en')).toBe('en');
    expect(resolveLocale('', 'en')).toBe('en');
  });

  it('falls through absent and non-string candidates', () => {
    expect(resolveLocale(undefined, 'en')).toBe('en');
    expect(resolveLocale(123, 'en')).toBe('en');
    expect(resolveLocale(['en'], 'en')).toBe('en');
  });

  it('defaults to zh when nothing is supported', () => {
    expect(resolveLocale(undefined, undefined)).toBe('zh');
    expect(resolveLocale('fr', 'cn')).toBe('zh');
  });
});
