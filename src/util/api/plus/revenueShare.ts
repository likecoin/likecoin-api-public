/* eslint-disable import/prefer-default-export */
import { ONE_DAY_IN_MS } from '../../../constant';

/**
 * Computes the per-day value of a Plus subscription term — the funding basis for
 * the reading-library revenue-share pool, which accrues per complete paid day.
 *
 * `amountPaid` is the net (post-discount) charge for the current term, so the
 * early/beta/full price tiers and the monthly/yearly discount are all captured by
 * the actual amount — no price table is needed. Term length is derived from the
 * provider period bounds (Stripe invoice periods or RevenueCat expirations), so
 * it is accurate to the day (28-31, 365/366).
 *
 * Returns 0 for trials, free periods, or malformed bounds: those contribute
 * nothing to the pool.
 */
export function calculatePlusDailyValue({
  amountPaid,
  currentPeriodStart,
  currentPeriodEnd,
}: {
  amountPaid: number;
  currentPeriodStart: number; // ms
  currentPeriodEnd: number; // ms
}): number {
  // `!(x > 0)` (not `x <= 0`) so NaN bounds are rejected rather than divided by.
  if (!(amountPaid > 0)) return 0;
  const termMs = currentPeriodEnd - currentPeriodStart;
  if (!(termMs > 0)) return 0;
  const termDays = Math.round(termMs / ONE_DAY_IN_MS);
  if (termDays <= 0) return 0;
  return amountPaid / termDays;
}
