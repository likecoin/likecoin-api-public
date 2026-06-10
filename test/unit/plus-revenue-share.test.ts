import { describe, it, expect } from 'vitest';
import { ONE_DAY_IN_MS } from '../../src/constant';
import {
  accruePoolUSD,
  calculatePlusDailyValue,
  getAccrualOverlapDays,
  getDayStartMs,
  getUsageDayId,
  getUsageMonthBoundsMs,
} from '../../src/util/api/plus/revenueShare';

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

describe('getUsageDayId', () => {
  it('buckets a timestamp into its UTC YYYY-MM-DD day', () => {
    expect(getUsageDayId(Date.UTC(2026, 2, 15, 12))).toBe('2026-03-15');
  });

  it('zero-pads single-digit months and days', () => {
    expect(getUsageDayId(Date.UTC(2026, 0, 5))).toBe('2026-01-05');
  });

  it('keeps the first millisecond of a day in that day', () => {
    expect(getUsageDayId(Date.UTC(2026, 1, 1, 0, 0, 0, 0))).toBe('2026-02-01');
  });

  it('keeps the last millisecond of a day in that day', () => {
    expect(getUsageDayId(Date.UTC(2026, 1, 2) - 1)).toBe('2026-02-01');
  });

  it('buckets by UTC, not local time, across a day boundary', () => {
    // 2026-01-31T23:30 UTC is still Jan 31 in UTC even though it is Feb 1 in any
    // positive-offset local zone (e.g. the project's HK timezone).
    expect(getUsageDayId(Date.UTC(2026, 0, 31, 23, 30))).toBe('2026-01-31');
  });

  it('round-trips through getDayStartMs (start-of-day stays the same day)', () => {
    const ts = Date.UTC(2026, 11, 25, 9, 30);
    const dayId = getUsageDayId(ts);
    const dayMs = getDayStartMs(ts);
    expect(dayId).toBe('2026-12-25');
    expect(dayMs).toBe(Date.UTC(2026, 11, 25));
    expect(getUsageDayId(dayMs)).toBe(dayId);
    expect(getUsageDayId(dayMs + ONE_DAY_IN_MS - 1)).toBe(dayId);
  });
});

describe('getUsageMonthBoundsMs', () => {
  it('returns UTC [start, end) bounds for a YYYY-MM period', () => {
    expect(getUsageMonthBoundsMs('2026-03')).toEqual({
      startMs: Date.UTC(2026, 2, 1),
      endMs: Date.UTC(2026, 3, 1),
    });
  });

  it('rolls December into the next year for the end bound', () => {
    expect(getUsageMonthBoundsMs('2026-12')).toEqual({
      startMs: Date.UTC(2026, 11, 1),
      endMs: Date.UTC(2027, 0, 1),
    });
  });
});

describe('getAccrualOverlapDays', () => {
  const janStart = Date.UTC(2026, 0, 1);
  const febStart = Date.UTC(2026, 1, 1);
  const marStart = Date.UTC(2026, 2, 1);

  it('returns the full paid days when the term sits inside the month', () => {
    // 31-day January term, entirely within January.
    expect(getAccrualOverlapDays(janStart, febStart, janStart, febStart)).toBeCloseTo(31, 10);
  });

  it('returns 0 when the term does not overlap the month', () => {
    // February term measured against January.
    expect(getAccrualOverlapDays(febStart, marStart, janStart, febStart)).toBe(0);
  });

  it('returns 0 for a malformed (non-positive) term', () => {
    expect(getAccrualOverlapDays(febStart, janStart, janStart, febStart)).toBe(0);
  });

  it('splits a boundary-spanning term so the parts sum to the full paid days', () => {
    // Term Jan 15 → Feb 15 (31 days); 17 days land in January, 14 in February.
    const termStart = Date.UTC(2026, 0, 15);
    const termEnd = Date.UTC(2026, 1, 15);
    const inJan = getAccrualOverlapDays(termStart, termEnd, janStart, febStart);
    const inFeb = getAccrualOverlapDays(termStart, termEnd, febStart, marStart);
    expect(inJan).toBeCloseTo(17, 10);
    expect(inFeb).toBeCloseTo(14, 10);
    expect(inJan + inFeb).toBeCloseTo(31, 10); // conserves the full term
  });
});

describe('accruePoolUSD', () => {
  it('sums dailyValueUSD × overlap days across terms for the period', () => {
    const accruals = [
      // Fully in March (31 days) → 0.3 × 31 = 9.3
      {
        dailyValueUSD: 0.3,
        currentPeriodStart: Date.UTC(2026, 2, 1),
        currentPeriodEnd: Date.UTC(2026, 3, 1),
      },
      // Mar 20 → Apr 20 (31 days); 12 days in March → 0.5 × 12 = 6
      {
        dailyValueUSD: 0.5,
        currentPeriodStart: Date.UTC(2026, 2, 20),
        currentPeriodEnd: Date.UTC(2026, 3, 20),
      },
    ];
    expect(accruePoolUSD(accruals, '2026-03')).toBeCloseTo(9.3 + 6, 6);
  });

  it('excludes terms outside the settlement month', () => {
    const accruals = [
      // Entirely in April → contributes nothing to March.
      {
        dailyValueUSD: 0.3,
        currentPeriodStart: Date.UTC(2026, 3, 1),
        currentPeriodEnd: Date.UTC(2026, 4, 1),
      },
    ];
    expect(accruePoolUSD(accruals, '2026-03')).toBe(0);
  });

  it('returns 0 for no accruals', () => {
    expect(accruePoolUSD([], '2026-03')).toBe(0);
  });
});
