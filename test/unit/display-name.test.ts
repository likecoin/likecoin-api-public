import {
  describe, it, expect,
} from 'vitest';
import {
  getRandomDisplayName,
  shouldUseZhDisplayName,
} from '../../src/util/api/users/displayName';
import {
  DISPLAY_NAME_PLACES_ZH,
  DISPLAY_NAME_PLACES_EN,
  DISPLAY_NAME_NATURE_ZH,
  DISPLAY_NAME_NATURE_EN,
} from '../../src/constant/displayName';

const SAMPLE_SIZE = 200;

function sample(input?: Parameters<typeof getRandomDisplayName>[0]) {
  return Array.from({ length: SAMPLE_SIZE }, () => getRandomDisplayName(input));
}

// Split on the last "'s " so the apostrophe inside Xi'an survives.
function splitEn(name: string) {
  const index = name.lastIndexOf("'s ");
  return { place: name.slice(0, index), nature: name.slice(index + 3), index };
}

describe('shouldUseZhDisplayName', () => {
  it('picks Chinese for Hong Kong, Taiwan and Macau IPs', () => {
    expect(shouldUseZhDisplayName({ ipCountry: 'HK' })).toBe(true);
    expect(shouldUseZhDisplayName({ ipCountry: 'TW' })).toBe(true);
    expect(shouldUseZhDisplayName({ ipCountry: 'MO' })).toBe(true);
    expect(shouldUseZhDisplayName({ ipCountry: 'hk' })).toBe(true);
  });

  it('picks English for every other IP', () => {
    expect(shouldUseZhDisplayName({ ipCountry: 'US' })).toBe(false);
    expect(shouldUseZhDisplayName({ ipCountry: 'JP' })).toBe(false);
    // Deliberately narrower than the frontend locale map, which sends these to zh.
    expect(shouldUseZhDisplayName({ ipCountry: 'SG' })).toBe(false);
    expect(shouldUseZhDisplayName({ ipCountry: 'CN' })).toBe(false);
  });

  it('lets a known IP override the locale in both directions', () => {
    expect(shouldUseZhDisplayName({ ipCountry: 'US', locale: 'zh' })).toBe(false);
    expect(shouldUseZhDisplayName({ ipCountry: 'HK', locale: 'en' })).toBe(true);
  });

  it('falls back to the locale when no IP is known', () => {
    expect(shouldUseZhDisplayName({ locale: 'zh' })).toBe(true);
    // 'cn' is the legacy Chinese code still on old docs.
    expect(shouldUseZhDisplayName({ locale: 'cn' })).toBe(true);
    expect(shouldUseZhDisplayName({ locale: 'en' })).toBe(false);
  });

  it('defaults to English with no signal at all', () => {
    expect(shouldUseZhDisplayName({})).toBe(false);
    expect(shouldUseZhDisplayName({ ipCountry: '', locale: '' })).toBe(false);
  });
});

describe('getRandomDisplayName', () => {
  it('builds Chinese names as <place>的<nature> from the Chinese pools', () => {
    sample({ ipCountry: 'HK' }).forEach((name) => {
      const [place, nature] = name.split('的');
      expect(DISPLAY_NAME_PLACES_ZH).toContain(place);
      expect(DISPLAY_NAME_NATURE_ZH).toContain(nature);
    });
  });

  it("builds English names as <city>'s <nature> from the English pools", () => {
    sample({ ipCountry: 'US' }).forEach((name) => {
      const { place, nature, index } = splitEn(name);
      expect(index).toBeGreaterThan(0);
      expect(DISPLAY_NAME_PLACES_EN).toContain(place);
      expect(DISPLAY_NAME_NATURE_EN).toContain(nature);
    });
  });

  it('names a city that already ends in s with the same possessive', () => {
    expect(DISPLAY_NAME_PLACES_EN).toContain('Paris');
    expect(splitEn("Paris's Lion")).toMatchObject({ place: 'Paris', nature: 'Lion' });
  });

  it('varies both halves, not just one', () => {
    const names = sample({ ipCountry: 'US' }).map(splitEn);
    expect(new Set(names.map((n) => n.place)).size).toBeGreaterThan(50);
    expect(new Set(names.map((n) => n.nature)).size).toBeGreaterThan(50);
  });

  it('defaults to an English name when called with no argument', () => {
    expect(sample().every((name) => name.includes("'s "))).toBe(true);
  });
});

describe('display name word pools', () => {
  it.each([
    ['places zh', DISPLAY_NAME_PLACES_ZH],
    ['places en', DISPLAY_NAME_PLACES_EN],
    ['nature zh', DISPLAY_NAME_NATURE_ZH],
    ['nature en', DISPLAY_NAME_NATURE_EN],
  ])('%s is non-empty and free of duplicates', (_label, pool) => {
    expect(pool.length).toBeGreaterThan(100);
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('keeps the separators out of the pools they join', () => {
    expect(DISPLAY_NAME_PLACES_ZH.some((p) => p.includes('的'))).toBe(false);
    expect(DISPLAY_NAME_NATURE_ZH.some((n) => n.includes('的'))).toBe(false);
    expect(DISPLAY_NAME_PLACES_EN.some((p) => p.includes("'s "))).toBe(false);
    expect(DISPLAY_NAME_NATURE_EN.some((n) => n.includes("'s "))).toBe(false);
  });
});
