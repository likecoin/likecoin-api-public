import { ONE_MINUTE_IN_MS } from '../../../constant';

/**
 * How the per-minute reading/TTS rates are derived. The first three split a fixed
 * pool across actual usage (so the rate floats); `static` instead pays a fixed rate
 * per minute regardless of the pool:
 * - `static`   — a fixed USD/min rate per channel (default `DEFAULT_STATIC_RATE_PER_MIN_USD`),
 *                independent of the pool. The settle job logs the resulting payout as a
 *                % of Plus revenue so it can be watched against the rev-share target.
 * - `blended`  — one rate over all minutes (a reading minute and a TTS minute pay equally).
 * - `split`    — the pool is divided into reading vs TTS sub-pools by `readShare`, each
 *                priced against its own minutes (lets the two channels pay differently).
 * - `weighted` — minutes are weighted (a TTS minute counts `ttsWeight` of a reading
 *                minute) then blended; `blended` is exactly `weighted(1, 1)`.
 */
export const PLUS_READING_ALLOCATION_MODES = ['static', 'blended', 'split', 'weighted'] as const;
export type PlusReadingAllocationMode = typeof PLUS_READING_ALLOCATION_MODES[number];

// Default static per-minute rate (USD). Live-tunable via the config doc's
// `readRatePerMinUSD` / `ttsRatePerMinUSD`, like the rev-share rate.
export const DEFAULT_STATIC_RATE_PER_MIN_USD = 0.01;

export interface PlusReadingAllocationConfig {
  mode: PlusReadingAllocationMode;
  // `static` only: fixed USD paid per reading / TTS minute. Each defaults to
  // `DEFAULT_STATIC_RATE_PER_MIN_USD`.
  readRatePerMinUSD?: number;
  ttsRatePerMinUSD?: number;
  // `split` only: fraction of the pool reserved for reading (0..1). Default 0.5.
  readShare?: number;
  // `weighted` only: relative value of a reading vs TTS minute. Default 1 / 1.
  readWeight?: number;
  ttsWeight?: number;
}

export interface PlusReadingUsageTotals {
  readingTimeMs: number;
  ttsTimeMs: number;
}

export interface PlusReadingRates {
  // USD paid per minute of reading / TTS for the settlement period.
  readRatePerMin: number;
  ttsRatePerMin: number;
}

const ZERO_RATES: PlusReadingRates = { readRatePerMin: 0, ttsRatePerMin: 0 };

// Coerce an externally-configured number (Firestore config doc) to a safe value: keep it
// only when finite and within [min, max], else fall back. Guards the money math against a
// malformed config (NaN / Infinity / out-of-range) before rates feed Stripe transfers.
export function configNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max = Infinity,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value : fallback;
}

/**
 * Derives the per-minute reading/TTS rates for the period, per the allocation mode.
 * The pool modes distribute `allocatableUSD` (the pool after the rev-share cut) across
 * the period's usage; a channel with no minutes gets a 0 rate, and under `split` that
 * can strand its sub-pool, which the settle job surfaces rather than silently dropping.
 * `static` ignores the pool entirely and returns the configured fixed per-minute rates.
 */
export function computePlusReadingRates(
  allocatableUSD: number,
  totals: PlusReadingUsageTotals,
  config: PlusReadingAllocationConfig,
): PlusReadingRates {
  // Static rate is pool-independent — resolve it before the allocatable-pool guard.
  if (config.mode === 'static') {
    return {
      readRatePerMin: configNumber(config.readRatePerMinUSD, DEFAULT_STATIC_RATE_PER_MIN_USD, 0),
      ttsRatePerMin: configNumber(config.ttsRatePerMinUSD, DEFAULT_STATIC_RATE_PER_MIN_USD, 0),
    };
  }
  if (!(allocatableUSD > 0)) return ZERO_RATES;
  const readMin = totals.readingTimeMs / ONE_MINUTE_IN_MS;
  const ttsMin = totals.ttsTimeMs / ONE_MINUTE_IN_MS;

  if (config.mode === 'split') {
    const readShare = configNumber(config.readShare, 0.5, 0, 1);
    const readPool = allocatableUSD * readShare;
    const ttsPool = allocatableUSD - readPool;
    return {
      readRatePerMin: readMin > 0 ? readPool / readMin : 0,
      ttsRatePerMin: ttsMin > 0 ? ttsPool / ttsMin : 0,
    };
  }

  // blended === weighted(1, 1) — fold both into the weighted path.
  const readWeight = config.mode === 'weighted' ? configNumber(config.readWeight, 1, 0) : 1;
  const ttsWeight = config.mode === 'weighted' ? configNumber(config.ttsWeight, 1, 0) : 1;
  const weightedMin = readMin * readWeight + ttsMin * ttsWeight;
  if (!(weightedMin > 0)) return ZERO_RATES;
  const baseRate = allocatableUSD / weightedMin;
  return {
    readRatePerMin: baseRate * readWeight,
    ttsRatePerMin: baseRate * ttsWeight,
  };
}

/**
 * USD owed to one book for a period: its reading and TTS minutes priced at the period rates.
 */
export function allocateBookUSD(
  rates: PlusReadingRates,
  usage: PlusReadingUsageTotals,
): number {
  return rates.readRatePerMin * (usage.readingTimeMs / ONE_MINUTE_IN_MS)
    + rates.ttsRatePerMin * (usage.ttsTimeMs / ONE_MINUTE_IN_MS);
}

/**
 * Splits an integer-cent amount across weighted payee wallets (mirrors the book
 * commission split). Uses the largest-remainder method so the parts sum to `amountCents`
 * exactly — no dust lost to flooring. Returns no entry for a wallet that rounds to 0.
 * Empty when there is nothing to split or no positive weight (caller handles the fallback).
 */
export function splitAmountToWallets(
  amountCents: number,
  connectedWallets: Record<string, number>,
): Array<{ wallet: string; amountCents: number }> {
  // Keep only finite, positive weights: a malformed split (negative / NaN / Infinity weight
  // from the book doc) could otherwise pass the totalWeight guard and inflate another wallet
  // past `amountCents` — and this feeds Stripe transfers from the platform balance.
  const entries = Object.entries(connectedWallets)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(amountCents > 0) || !(totalWeight > 0)) return [];

  const parts = entries.map(([wallet, weight]) => {
    const exact = (amountCents * weight) / totalWeight;
    const floored = Math.floor(exact);
    return { wallet, amountCents: floored, frac: exact - floored };
  });
  // Hand each leftover cent to the highest fractional parts so the split is exact.
  // Tie-break by wallet so equal fractions resolve deterministically across re-runs —
  // the Stripe idempotency key omits the amount, so the cent must land on the same wallet.
  let remainder = amountCents - parts.reduce((sum, p) => sum + p.amountCents, 0);
  parts.sort((a, b) => (b.frac - a.frac) || a.wallet.localeCompare(b.wallet));
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    parts[i % parts.length].amountCents += 1;
  }
  return parts
    .filter((p) => p.amountCents > 0)
    .map(({ wallet, amountCents: cents }) => ({ wallet, amountCents: cents }));
}
