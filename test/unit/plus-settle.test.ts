import { describe, it, expect } from 'vitest';
import { ONE_MINUTE_IN_MS } from '../../src/constant';
import {
  DEFAULT_STATIC_RATE_PER_MIN_USD,
  allocateBookUSD,
  computePlusReadingRates,
  splitAmountToWallets,
} from '../../src/util/api/plus/settle';
import { settlePlusReadingPeriod } from '../../src/util/api/plus/settleJob';
import { PlusSettleResponseSchema } from '../../src/util/api/plus/schemas';
import { likeNFTBookCollection } from '../../src/util/firebase';

const min = (n: number) => n * ONE_MINUTE_IN_MS;
const sumCents = (parts: Array<{ amountCents: number }>) => parts
  .reduce((s, p) => s + p.amountCents, 0);

describe('computePlusReadingRates', () => {
  it('blended: one rate across all minutes', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(60), ttsTimeMs: min(40) },
      { mode: 'blended' },
    );
    // 100 USD / 100 min = 1 USD/min, applied equally to both channels.
    expect(rates.readRatePerMin).toBeCloseTo(1, 10);
    expect(rates.ttsRatePerMin).toBeCloseTo(1, 10);
  });

  it('split: each channel priced against its own minutes by readShare', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(50), ttsTimeMs: min(100) },
      { mode: 'split', readShare: 0.5 },
    );
    // readPool 50 / 50 min = 1; ttsPool 50 / 100 min = 0.5
    expect(rates.readRatePerMin).toBeCloseTo(1, 10);
    expect(rates.ttsRatePerMin).toBeCloseTo(0.5, 10);
  });

  it('weighted: a TTS minute counts ttsWeight of a reading minute', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(50), ttsTimeMs: min(100) },
      { mode: 'weighted', readWeight: 1, ttsWeight: 0.5 },
    );
    // weighted minutes = 50*1 + 100*0.5 = 100; baseRate 1 → read 1, tts 0.5
    expect(rates.readRatePerMin).toBeCloseTo(1, 10);
    expect(rates.ttsRatePerMin).toBeCloseTo(0.5, 10);
  });

  it('blended equals weighted(1, 1)', () => {
    const totals = { readingTimeMs: min(37), ttsTimeMs: min(91) };
    const blended = computePlusReadingRates(250, totals, { mode: 'blended' });
    const weighted = computePlusReadingRates(
      250,
      totals,
      { mode: 'weighted', readWeight: 1, ttsWeight: 1 },
    );
    expect(weighted).toEqual(blended);
  });

  it('returns zero rates when there is nothing to allocate', () => {
    expect(computePlusReadingRates(0, { readingTimeMs: min(10), ttsTimeMs: min(10) }, { mode: 'blended' }))
      .toEqual({ readRatePerMin: 0, ttsRatePerMin: 0 });
  });

  it('returns zero rates when there is no usage', () => {
    expect(computePlusReadingRates(100, { readingTimeMs: 0, ttsTimeMs: 0 }, { mode: 'blended' }))
      .toEqual({ readRatePerMin: 0, ttsRatePerMin: 0 });
  });

  it('static: fixed configured rates, independent of the pool', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(60), ttsTimeMs: min(40) },
      { mode: 'static', readRatePerMinUSD: 0.02, ttsRatePerMinUSD: 0.005 },
    );
    expect(rates.readRatePerMin).toBe(0.02);
    expect(rates.ttsRatePerMin).toBe(0.005);
  });

  it('static: defaults each channel to DEFAULT_STATIC_RATE_PER_MIN_USD', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(60), ttsTimeMs: min(40) },
      { mode: 'static' },
    );
    expect(rates.readRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
    expect(rates.ttsRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
  });

  it('static: still pays when there is no pool to allocate', () => {
    const rates = computePlusReadingRates(
      0,
      { readingTimeMs: min(60), ttsTimeMs: min(40) },
      { mode: 'static' },
    );
    expect(rates.readRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
    expect(rates.ttsRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
  });

  it('static: falls back to the default when a configured rate is non-finite', () => {
    const rates = computePlusReadingRates(
      0,
      { readingTimeMs: min(60), ttsTimeMs: min(40) },
      { mode: 'static', readRatePerMinUSD: NaN, ttsRatePerMinUSD: -1 },
    );
    expect(rates.readRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
    expect(rates.ttsRatePerMin).toBe(DEFAULT_STATIC_RATE_PER_MIN_USD);
  });

  it('split: an out-of-range readShare falls back to the 0.5 default', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: min(50), ttsTimeMs: min(100) },
      { mode: 'split', readShare: 1.5 },
    );
    // 1.5 is rejected → readShare 0.5: readPool 50 / 50 min = 1; ttsPool 50 / 100 min = 0.5.
    expect(rates.readRatePerMin).toBeCloseTo(1, 10);
    expect(rates.ttsRatePerMin).toBeCloseTo(0.5, 10);
  });

  it('split: a channel with no minutes gets a 0 rate (its sub-pool strands)', () => {
    const rates = computePlusReadingRates(
      100,
      { readingTimeMs: 0, ttsTimeMs: min(50) },
      { mode: 'split', readShare: 0.5 },
    );
    expect(rates.readRatePerMin).toBe(0);
    expect(rates.ttsRatePerMin).toBeCloseTo(1, 10); // ttsPool 50 / 50 min
  });
});

describe('allocateBookUSD', () => {
  it('prices a book by its reading and TTS minutes', () => {
    const amount = allocateBookUSD(
      { readRatePerMin: 1, ttsRatePerMin: 0.5 },
      { readingTimeMs: min(10), ttsTimeMs: min(20) },
    );
    expect(amount).toBeCloseTo(1 * 10 + 0.5 * 20, 10); // 20
  });

  it('is 0 when rates are 0', () => {
    const zeroRates = { readRatePerMin: 0, ttsRatePerMin: 0 };
    expect(allocateBookUSD(zeroRates, { readingTimeMs: min(5), ttsTimeMs: min(5) })).toBe(0);
  });
});

describe('splitAmountToWallets', () => {
  it('splits evenly and conserves every cent', () => {
    const parts = splitAmountToWallets(100, { a: 1, b: 1, c: 1 });
    expect(sumCents(parts)).toBe(100);
    expect(parts.map((p) => p.amountCents).sort()).toEqual([33, 33, 34]);
  });

  it('splits by weight, leftover cent to the higher fractional part', () => {
    const parts = splitAmountToWallets(100, { a: 2, b: 1 });
    const byWallet = Object.fromEntries(parts.map((p) => [p.wallet, p.amountCents]));
    expect(byWallet).toEqual({ a: 67, b: 33 });
    expect(sumCents(parts)).toBe(100);
  });

  it('conserves cents that do not divide evenly', () => {
    expect(sumCents(splitAmountToWallets(101, { a: 1, b: 1, c: 1 }))).toBe(101);
  });

  it('sends everything to a single wallet', () => {
    expect(splitAmountToWallets(100, { a: 1 })).toEqual([{ wallet: 'a', amountCents: 100 }]);
  });

  it('drops wallets that round down to zero', () => {
    const parts = splitAmountToWallets(1, { a: 1, b: 1000000 });
    expect(parts).toEqual([{ wallet: 'b', amountCents: 1 }]);
  });

  it('returns empty when there is nothing to split or no weight', () => {
    expect(splitAmountToWallets(0, { a: 1 })).toEqual([]);
    expect(splitAmountToWallets(100, {})).toEqual([]);
  });
});

describe('settlePlusReadingPeriod readerCount', () => {
  // Seeds a book with one plusUsage day rollup and its per-reader grain. The stub's
  // doc() resolves the stored object at call time, so re-fetch after each set() before
  // descending into a subcollection.
  async function seedBookUsageDay(
    classId: string,
    dayId: string,
    readingTimeMs: number,
    readers: string[],
  ) {
    // Date-only ISO strings parse as UTC midnight — the dayMs the settle range filters on.
    const dayMs = Date.parse(dayId);
    const bookDocRef = likeNFTBookCollection.doc(classId);
    if (!(await bookDocRef.get()).exists) {
      await bookDocRef.set({ classId, ownerWallet: '0xowner' });
    }
    const usageCol = likeNFTBookCollection.doc(classId).collection('plusUsage');
    await usageCol.doc(dayId).set({ readingTimeMs, ttsTimeMs: 0, dayMs });
    await Promise.all(readers.map((wallet) => usageCol.doc(dayId).collection('readers')
      .doc(wallet).set({ readingTimeMs, ttsTimeMs: 0 })));
  }

  it('counts unique library readers per book and across the period', async () => {
    // book1: reader A on two days (dedup within a book), + B on the second day.
    await seedBookUsageDay('0xbook1', '2026-01-05', min(10), ['0xreaderA']);
    await seedBookUsageDay('0xbook1', '2026-01-06', min(20), ['0xreaderA', '0xreaderB']);
    // book2: reader B again (dedup across books in the summary).
    await seedBookUsageDay('0xbook2', '2026-01-07', min(5), ['0xreaderB']);
    // Outside the period — reader C must not leak into January's counts.
    await seedBookUsageDay('0xbook1', '2025-12-31', min(15), ['0xreaderC']);

    const result = await settlePlusReadingPeriod({ periodId: '2026-01', dryRun: true });

    expect(result.readerCount).toBe(2); // A + B, C excluded, B counted once
    const byClass = Object.fromEntries(result.books.map((b) => [b.classId, b]));
    expect(byClass['0xbook1'].readerCount).toBe(2);
    expect(byClass['0xbook2'].readerCount).toBe(1);

    // Lockstep guard: sendValidatedJSON strips fields the schema doesn't know about,
    // so the counts must survive a schema parse to actually reach the response.
    const parsed = PlusSettleResponseSchema.parse({ success: true, ...result });
    expect(parsed.readerCount).toBe(2);
    expect(parsed.books.find((b) => b.classId === '0xbook1')?.readerCount).toBe(2);
  });
});
