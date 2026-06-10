import { likeNFTBookCollection } from '../../firebase';
import { getPeriodBoundsMs } from './revenueShare';

// When no `period` is requested, bound the per-book usage read to this trailing window of
// calendar months (rather than an unbounded all-history scan that grows days × books).
const DEFAULT_STATS_WINDOW_MONTHS = 12;

export interface PlusReadingStatsEntry {
  classId: string;
  periodId: string;
  readingTimeMs: number;
  ttsTimeMs: number;
}

export interface PlusReadingStats {
  stats: PlusReadingStatsEntry[];
  summary: {
    totalReadingTimeMs: number;
    totalTTSTimeMs: number;
    bookCount: number;
    periodCount: number;
  };
}

/**
 * Rolls up reading/TTS stat rows into period/book totals. Pure — the Firestore read
 * lives in getPlusReadingStatsForWallet so this stays unit-testable.
 */
export function summarizePlusReadingStats(
  entries: PlusReadingStatsEntry[],
): PlusReadingStats['summary'] {
  const totals = entries.reduce(
    (acc, e) => {
      acc.totalReadingTimeMs += e.readingTimeMs;
      acc.totalTTSTimeMs += e.ttsTimeMs;
      return acc;
    },
    { totalReadingTimeMs: 0, totalTTSTimeMs: 0 },
  );
  return {
    ...totals,
    bookCount: new Set(entries.map((e) => e.classId)).size,
    periodCount: new Set(entries.map((e) => e.periodId)).size,
  };
}

/**
 * Plus reading-library engagement for a publisher's own books: per book+period reading and
 * TTS durations from the daily usage rollups (`likeNFTBookCollection/{classId}/plusUsage/
 * {YYYY-MM-DD}`). Live — covers the current, not-yet-settled period, unlike the payout-ledger
 * report. Scoped to books the wallet owns (`ownerWallet`); an optional `classId` narrows to a
 * single owned book (e.g. a per-book detail page) without trusting the caller for ownership.
 * By default each day rolls up to its calendar month (`periodId` = `YYYY-MM`) over a trailing
 * window (the last DEFAULT_STATS_WINDOW_MONTHS months) so the read stays bounded; an optional
 * `period` (a `YYYY-MM` month or a `YYYY-MM-DD` day) sums just that window into one entry per
 * book. Sorted newest period first, then by book.
 *
 * Usage is written under the lowercase canonical classId (recordPlusReadingUsage lowercases
 * on write and requires that book doc), so the usage read and the returned `classId` are
 * lowercased — keeping the join key consistent with the payout ledger.
 */
export async function getPlusReadingStatsForWallet(
  wallet: string,
  { periodId, classId: filterClassId }: { periodId?: string; classId?: string } = {},
): Promise<PlusReadingStats> {
  let bookQuery = likeNFTBookCollection.where('ownerWallet', '==', wallet);
  // Narrow to one owned book via the lowercased canonical `classId` (always stored lowercase).
  // Ownership still comes from the `ownerWallet` query, so the caller can't read another's book.
  if (filterClassId) bookQuery = bookQuery.where('classId', '==', filterClassId.toLowerCase());
  const bookSnap = await bookQuery.get();
  const bounds = periodId ? getPeriodBoundsMs(periodId) : null;
  // No period requested: still bound the read to the trailing window's first-of-month start,
  // so an active book's whole history isn't scanned. Date.UTC normalizes the negative-month
  // overflow (e.g. month -6 rolls back into the previous year).
  const now = new Date();
  const defaultStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - (DEFAULT_STATS_WINDOW_MONTHS - 1),
    1,
  );

  const perBook = await Promise.all(bookSnap.docs.map(async (bookDoc) => {
    const classId = bookDoc.id.toLowerCase();
    const usageCol = likeNFTBookCollection.doc(classId).collection('plusUsage');
    // When filtered to a period, push the `dayMs` range server-side (the same bound the settle
    // job uses) so an active book's whole usage history isn't read just to drop most of it.
    const usageQuery = bounds
      ? usageCol.where('dayMs', '>=', bounds.startMs).where('dayMs', '<', bounds.endMs)
      : usageCol.where('dayMs', '>=', defaultStartMs);
    const usageDocs = (await usageQuery.get()).docs;
    // Sum daily rollups into the reported bucket: the requested period when filtered to one
    // window, else each day's own calendar month (`YYYY-MM`).
    const byPeriod = new Map<string, PlusReadingStatsEntry>();
    usageDocs.forEach((doc) => {
      const data = doc.data() || {};
      const bucket = periodId || doc.id.slice(0, 7);
      const entry = byPeriod.get(bucket)
        || {
          classId, periodId: bucket, readingTimeMs: 0, ttsTimeMs: 0,
        };
      entry.readingTimeMs += Number(data.readingTimeMs) || 0;
      entry.ttsTimeMs += Number(data.ttsTimeMs) || 0;
      byPeriod.set(bucket, entry);
    });
    return [...byPeriod.values()];
  }));

  const stats = perBook
    .flat()
    .filter((e) => e.readingTimeMs > 0 || e.ttsTimeMs > 0)
    .sort((a, b) => (a.periodId === b.periodId
      ? a.classId.localeCompare(b.classId)
      : b.periodId.localeCompare(a.periodId)));

  return { stats, summary: summarizePlusReadingStats(stats) };
}
