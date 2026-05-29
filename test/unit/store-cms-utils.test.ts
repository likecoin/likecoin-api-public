import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from '../../src/util/misc';

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
