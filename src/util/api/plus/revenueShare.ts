import { checksumAddress } from 'viem';
import { ONE_DAY_IN_MS } from '../../../constant';
import {
  FieldValue, Timestamp, db, likeNFTBookCollection, userCollection,
} from '../../firebase';
import { ValidationError } from '../../ValidationError';
import type { PlusReadingAccrualData } from '../../../types/user';

/**
 * Config doc for the reading-library revenue share. Holds the rate/mode/weights and a
 * `periods/{periodId}` subcollection of settled-period summaries (pool, unit rates, status).
 */
export const PLUS_READING_REVSHARE_CONFIG_DOC_ID = 'plusReadingRevShare';

/**
 * Whole paid days in a term, rounding sub-day clock jitter. The stored accrual
 * `paidDays` and the settle-time overlap basis must round identically or pool
 * conservation (Σ monthly overlaps = term paidDays) breaks — so both derive it here.
 */
function roundTermDays(termMs: number): number {
  return Math.round(termMs / ONE_DAY_IN_MS);
}

/**
 * Computes the per-day value of a Plus subscription term — the funding basis for
 * the reading-library revenue-share pool, which accrues proportionally over the term.
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
  const termDays = roundTermDays(termMs);
  if (termDays <= 0) return 0;
  return amountPaid / termDays;
}

/**
 * Usage bucket for a timestamp: a UTC calendar day, `YYYY-MM-DD`. Daily granularity lets
 * settlement run over any range — a single day, or a whole month summed from its days. UTC
 * (not the project's HK timezone) keeps bucketing deterministic and matches the web backend's
 * UTC date handling for reading streaks.
 */
export function getUsageDayId(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * UTC start-of-day ms for a timestamp — stored on each daily usage rollup as `dayMs` so a
 * settlement range can filter rollups by time without parsing their `YYYY-MM-DD` doc id.
 */
export function getDayStartMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// How long a dedup receipt is kept. Retries of a dropped forward arrive within
// seconds; days of margin covers a stuck queue. A Firestore TTL policy on
// `plusUsageReceipts.expireAt` purges them so they don't grow unbounded.
const USAGE_RECEIPT_TTL_MS = 7 * ONE_DAY_IN_MS;
// gRPC ALREADY_EXISTS: a batched create() of a doc that already exists rejects
// commit with this code — how the idempotency gate detects a duplicate delivery.
const GRPC_ALREADY_EXISTS = 6;

/**
 * Records already-paced (anti-fraud) Plus reading/TTS usage into the day-bucketed
 * ledger funding the reading-library revenue share — a trusted write. Dual-writes the
 * book rollup and a per-reader grain in one batch, both hanging off the book doc so
 * settlement reads ownerWallet/connectedWallets live from the parent (no snapshot drift).
 * Requires the parent book doc to exist — Firestore would otherwise happily create an
 * orphan ledger under a missing parent that settlement could never attribute.
 * `classId` (a contract address) is lowercased and `readerWallet` is EIP-55 checksummed
 * per repo convention, so casing variants don't split the same book/reader across docs and
 * reader keys match `likeNFTBookUserCollection`/`userCollection` (both checksummed).
 * An `id` makes the write idempotent (see the receipt in the batch below).
 */
export async function recordPlusReadingUsage({
  id,
  readerWallet,
  classId,
  readingTimeMs,
  ttsTimeMs,
  nonLibraryReadingTimeMs = 0,
  nonLibraryTtsTimeMs = 0,
  occurredAt,
}: {
  // Idempotency key. When present, a repeat delivery (e.g. a retried forward after
  // a lost response) is detected and skipped, so the non-idempotent increments below
  // can't double-count. Absent → no dedup.
  id?: string;
  readerWallet: string;
  classId: string;
  readingTimeMs: number;
  ttsTimeMs: number;
  // Non-rev-share engagement (owned/non-Plus reads): rolled up per book+day for
  // publisher stats, but never written to the per-reader grain and never read by
  // settlement, so payouts stay library-only.
  nonLibraryReadingTimeMs?: number;
  nonLibraryTtsTimeMs?: number;
  occurredAt?: number;
}): Promise<{ dayId: string; applied: boolean }> {
  const ts = occurredAt ?? Date.now();
  const dayId = getUsageDayId(ts);
  const dayMs = getDayStartMs(ts);
  const normalizedClassId = classId.toLowerCase();
  const normalizedReaderWallet = checksumAddress(readerWallet as `0x${string}`);

  const bookDocRef = likeNFTBookCollection.doc(normalizedClassId);
  const bookDoc = await bookDocRef.get();
  if (!bookDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);

  const dayDocRef = bookDocRef.collection('plusUsage').doc(dayId);
  const readerDocRef = dayDocRef.collection('readers').doc(normalizedReaderWallet);

  const usageIncrement = {
    readingTimeMs: FieldValue.increment(readingTimeMs),
    ttsTimeMs: FieldValue.increment(ttsTimeMs),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  // Idempotency gate: claim the key with create() in the SAME batch as the increments,
  // so the whole write is atomic — a duplicate id fails commit with ALREADY_EXISTS and
  // nothing is applied (no double-count, no claim-without-increment window). Receipts hang
  // off the (always-present) book doc, not the day rollup, so the first delta of a day still
  // dedups.
  if (id) {
    batch.create(bookDocRef.collection('plusUsageReceipts').doc(id), {
      createdAt: FieldValue.serverTimestamp(),
      // Base the TTL on ingest time, not `ts` (which may be a historical `occurredAt`),
      // so a backfilled delivery still gets the full retry-dedup window.
      expireAt: Timestamp.fromMillis(Date.now() + USAGE_RECEIPT_TTL_MS),
    });
  }
  // `dayMs` (UTC start-of-day) lets settlement filter rollups by range without parsing ids.
  // The day rollup also carries the non-library engagement totals (settlement ignores them).
  batch.set(dayDocRef, {
    ...usageIncrement,
    nonLibraryReadingTimeMs: FieldValue.increment(nonLibraryReadingTimeMs),
    nonLibraryTtsTimeMs: FieldValue.increment(nonLibraryTtsTimeMs),
    dayMs,
  }, { merge: true });
  // Per-reader grain is rev-share audit only — skip it for pure non-library
  // engagement so non-Plus readers don't each spawn a reader doc.
  if (readingTimeMs > 0 || ttsTimeMs > 0) {
    batch.set(readerDocRef, usageIncrement, { merge: true });
  }

  try {
    await batch.commit();
  } catch (err) {
    // Duplicate id — the delta was already recorded, so this is a no-op retry.
    if ((err as { code?: number }).code === GRPC_ALREADY_EXISTS) return { dayId, applied: false };
    throw err;
  }

  return { dayId, applied: true };
}

/**
 * Records a per-term accrual entry that funds the reading-library
 * revenue-share pool, under `users/{likerId}/plusReadingAccrual/{termKey}`.
 *
 * Written at invoice time rather than recomputed at settle time: the shared
 * `likerPlus` record is latest-write-wins, so a renewal would overwrite a prior
 * term's dailyValue before settlement reads it. One doc per paid term, keyed by
 * `${subscriptionId}_${currentPeriodStart}` — reprocessing the same invoice overwrites
 * the same accrual fields (only `updatedAt` changes), so it is idempotent. `dailyValueUSD`
 * is already normalized to USD so settlement sums a single currency. No-op for trials / malformed
 * terms (they fund nothing).
 */
export async function recordPlusSubscriptionAccrual({
  likerId,
  subscriptionId,
  dailyValueUSD,
  currency,
  currentPeriodStart,
  currentPeriodEnd,
  provider,
}: {
  likerId: string;
  subscriptionId: string;
  dailyValueUSD: number;
  currency: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  provider: PlusReadingAccrualData['provider'];
}): Promise<void> {
  if (!(dailyValueUSD > 0)) return;
  const termMs = currentPeriodEnd - currentPeriodStart;
  if (!(termMs > 0)) return;
  const paidDays = roundTermDays(termMs);
  if (paidDays <= 0) return;

  const termKey = `${subscriptionId}_${currentPeriodStart}`;
  const accrual: PlusReadingAccrualData = {
    dailyValueUSD,
    currency,
    currentPeriodStart,
    currentPeriodEnd,
    paidDays,
    provider,
    subscriptionId,
  };
  await userCollection
    .doc(likerId)
    .collection('plusReadingAccrual')
    .doc(termKey)
    .set({ ...accrual, updatedAt: FieldValue.serverTimestamp() });
}

/**
 * UTC millisecond bounds `[startMs, endMs)` of a settlement period — either a whole month
 * (`YYYY-MM`) or a single day (`YYYY-MM-DD`). A 2-part id is a month, a 3-part id a day;
 * format/validity is enforced upstream by `PlusSettleBodySchema`. `Date.UTC` normalizes the
 * end bound's overflow, so a month-end or Dec-31 day rolls into the next month/year.
 */
export function getPeriodBoundsMs(periodId: string): { startMs: number; endMs: number } {
  const [year, month, day] = periodId.split('-').map(Number);
  if (day === undefined) {
    return { startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };
  }
  return { startMs: Date.UTC(year, month - 1, day), endMs: Date.UTC(year, month - 1, day + 1) };
}

/**
 * Fractional paid days of an accrual term that fall inside a settlement month,
 * distributed proportionally so summing across every month a term spans returns the
 * term's full `paidDays` exactly (no month-boundary rounding drift).
 */
export function getAccrualOverlapDays(
  termStartMs: number,
  termEndMs: number,
  monthStartMs: number,
  monthEndMs: number,
): number {
  const termMs = termEndMs - termStartMs;
  if (!(termMs > 0)) return 0;
  const overlapMs = Math.min(termEndMs, monthEndMs) - Math.max(termStartMs, monthStartMs);
  if (!(overlapMs > 0)) return 0;
  const paidDays = roundTermDays(termMs);
  return paidDays * (overlapMs / termMs);
}

/**
 * Sums the USD funding attributable to a settlement window `[startMs, endMs)`: each accrual
 * term contributes `dailyValueUSD × overlapDays(term, window)`. Pure — settlement reads the
 * accrual docs from Firestore and passes them in.
 */
export function accruePoolUSD(
  accruals: Array<Pick<PlusReadingAccrualData, 'dailyValueUSD' | 'currentPeriodStart' | 'currentPeriodEnd'>>,
  startMs: number,
  endMs: number,
): number {
  return accruals.reduce(
    (sum, a) => sum + a.dailyValueUSD * getAccrualOverlapDays(
      a.currentPeriodStart,
      a.currentPeriodEnd,
      startMs,
      endMs,
    ),
    0,
  );
}
