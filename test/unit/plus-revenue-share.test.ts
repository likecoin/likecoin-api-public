import { describe, it, expect } from 'vitest';
import { ONE_DAY_IN_MS } from '../../src/constant';
import { calculatePlusDailyValue } from '../../src/util/api/plus/revenueShare';

const monthStart = Date.UTC(2026, 0, 1);

describe('calculatePlusDailyValue', () => {
  it('divides a monthly charge by the exact term days', () => {
    // 31-day January term, $9.99 → 9.99 / 31
    const daily = calculatePlusDailyValue({
      amountPaid: 9.99,
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart + 31 * ONE_DAY_IN_MS,
    });
    expect(daily).toBeCloseTo(9.99 / 31, 10);
  });

  it('divides a yearly charge by the exact term days', () => {
    // 365-day term, $99.99 → 99.99 / 365 (smaller daily value reflects the yearly discount)
    const daily = calculatePlusDailyValue({
      amountPaid: 99.99,
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart + 365 * ONE_DAY_IN_MS,
    });
    expect(daily).toBeCloseTo(99.99 / 365, 10);
  });

  it('captures price tiers via the actual amount (no price table)', () => {
    // Same 30-day term, different tier prices → proportional daily values.
    const term = {
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart + 30 * ONE_DAY_IN_MS,
    };
    expect(calculatePlusDailyValue({ amountPaid: 6, ...term })).toBeCloseTo(0.2, 10);
    expect(calculatePlusDailyValue({ amountPaid: 9, ...term })).toBeCloseTo(0.3, 10);
  });

  it('returns 0 for trials / free periods (no amount paid)', () => {
    expect(calculatePlusDailyValue({
      amountPaid: 0,
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart + 14 * ONE_DAY_IN_MS,
    })).toBe(0);
  });

  it('returns 0 for malformed or non-positive term bounds', () => {
    expect(calculatePlusDailyValue({
      amountPaid: 9.99,
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart,
    })).toBe(0);
    expect(calculatePlusDailyValue({
      amountPaid: 9.99,
      currentPeriodStart: monthStart + ONE_DAY_IN_MS,
      currentPeriodEnd: monthStart,
    })).toBe(0);
  });

  it('rounds sub-day jitter to whole days (accurate-to-day unit)', () => {
    // 30 days minus a few seconds (clock jitter) still rounds to a 30-day term.
    const daily = calculatePlusDailyValue({
      amountPaid: 9,
      currentPeriodStart: monthStart,
      currentPeriodEnd: monthStart + 30 * ONE_DAY_IN_MS - 5000,
    });
    expect(daily).toBeCloseTo(9 / 30, 10);
  });
});
