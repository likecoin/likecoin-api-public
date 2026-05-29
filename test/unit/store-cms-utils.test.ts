import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from '../../src/util/misc';
import { getMinListedPriceInDecimal } from '../../src/util/api/likernft/book';
import type { NFTBookPrice } from '../../src/types/book';

const price = (overrides: Partial<NFTBookPrice>): NFTBookPrice => (
  { priceInDecimal: 0, ...overrides } as NFTBookPrice
);

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true);
  });

  it('returns false for different same-length strings', () => {
    expect(constantTimeEqual('secret', 'sECRET')).toBe(false);
  });

  // timingSafeEqual throws on buffers of unequal length,
  // so the helper must short-circuit before calling it. This guards that contract.
  it('returns false (without throwing) for different-length strings', () => {
    expect(() => constantTimeEqual('short', 'much longer')).not.toThrow();
    expect(constantTimeEqual('short', 'much longer')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('getMinListedPriceInDecimal', () => {
  it('returns the minimum priceInDecimal across listed prices', () => {
    expect(getMinListedPriceInDecimal([
      price({ priceInDecimal: 500 }),
      price({ priceInDecimal: 100 }),
      price({ priceInDecimal: 300 }),
    ])).toBe(100);
  });

  it('ignores unlisted prices when computing the min', () => {
    expect(getMinListedPriceInDecimal([
      price({ priceInDecimal: 500 }),
      price({ priceInDecimal: 50, isUnlisted: true }),
      price({ priceInDecimal: 300 }),
    ])).toBe(300);
  });

  it('returns undefined when every price is unlisted', () => {
    expect(getMinListedPriceInDecimal([
      price({ priceInDecimal: 500, isUnlisted: true }),
      price({ priceInDecimal: 100, isUnlisted: true }),
    ])).toBeUndefined();
  });

  it('returns undefined for an empty / missing prices array', () => {
    expect(getMinListedPriceInDecimal([])).toBeUndefined();
    expect(getMinListedPriceInDecimal()).toBeUndefined();
  });

  it('filters out non-numeric priceInDecimal entries', () => {
    expect(getMinListedPriceInDecimal([
      { priceInDecimal: 'NaN' as unknown as number } as NFTBookPrice,
      price({ priceInDecimal: 200 }),
    ])).toBe(200);
  });

  it('filters out NaN priceInDecimal entries', () => {
    // typeof NaN === 'number';
    // a naive numeric check would let it through and poison the reducer with NaN.
    expect(getMinListedPriceInDecimal([
      price({ priceInDecimal: NaN }),
      price({ priceInDecimal: 200 }),
    ])).toBe(200);
  });
});
