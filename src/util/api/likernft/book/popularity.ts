import { ONE_DAY_IN_MS } from '../../../../constant';

// Time-weighted popularity score: usage ms × 2^(days / halfLife), so recent reading outweighs
// old reading without any decay job — writes happen only at usage time, no cron. Usage is
// floored to the UTC day, which is what lets the backfill recompute a book's score from its
// `plusUsage` daily rollups and land on what the live increments accumulated.
// The product (not the exponent) overflows float64 around Sept 2045 — the millisecond
// multiplicand costs ~6 months against salesScore's unit weight — so rebase both epochs
// together well before then.
export const READING_SCORE_EPOCH_MS = Date.UTC(2026, 7, 1);
export const READING_SCORE_HALF_LIFE_DAYS = 7;

export function getReadingScoreIncrement(usageMs: number, occurredAtMs: number) {
  // Unlike a sale, a malformed duration has no honest floor — the event carries no unit of its
  // own — so it scores nothing rather than guessing 1 the way getSaleScoreIncrement does.
  // `occurredAtMs` is guarded too because it feeds the exponent and, unlike `usageMs`, carries
  // no upper bound upstream (PlusReadingUsage `occurredAt` is only `int().positive()`): a units
  // bug in the forwarder would otherwise land Infinity here, and an incremented Infinity pins a
  // book to rank 1 permanently — the backfill can't heal it, since it recomputes off the same
  // bad timestamp.
  if (!(usageMs > 0) || !Number.isFinite(occurredAtMs)) return 0;
  const days = Math.floor((occurredAtMs - READING_SCORE_EPOCH_MS) / ONE_DAY_IN_MS);
  const increment = usageMs * 2 ** (days / READING_SCORE_HALF_LIFE_DAYS);
  return Number.isFinite(increment) ? increment : 0;
}
