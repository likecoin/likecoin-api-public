/* eslint-disable no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-continue, import/prefer-default-export */
import {
  FieldValue, db, configCollection, likeNFTBookCollection, likeNFTBookUserCollection,
} from '../../firebase';
import { getStripeClient } from '../../stripe';
import { getBookUserInfo } from '../likernft/book/user';
import { ValidationError } from '../../ValidationError';
import {
  accruePoolUSD, getPeriodBoundsMs, PLUS_READING_REVSHARE_CONFIG_DOC_ID,
} from './revenueShare';
import {
  PLUS_READING_ALLOCATION_MODES,
  allocateBookUSD,
  computePlusReadingRates,
  configNumber,
  splitAmountToWallets,
} from './settle';
import type { PlusReadingAllocationConfig, PlusReadingAllocationMode } from './settle';
import type { PlusReadingAccrualData } from '../../../types/user';
import type { NFTBookListingInfo } from '../../../types/book';

const DEFAULT_REVSHARE_RATE = 0.3;

// Kept modest so a large period doesn't burst past Stripe's rate limit and leave
// transfers spuriously carried forward as `pending`.
const SETTLE_CONCURRENCY = 20;

interface BookUsage {
  classId: string;
  readingTimeMs: number;
  ttsTimeMs: number;
}

interface WalletPayout {
  periodId: string;
  book: BookUsage;
  wallet: string;
  walletCents: number;
}

type PayoutOutcome = 'paid' | 'pending' | 'skipped';

/**
 * Maps `items` in bounded-concurrency chunks, preserving input order — the settle's
 * Firestore reads and Stripe transfers are IO-bound, so they run wide rather than one at
 * a time. Fail-fast: a rejection aborts the remaining chunks.
 */
async function mapInChunks<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += SETTLE_CONCURRENCY) {
    const chunk = items.slice(i, i + SETTLE_CONCURRENCY);
    results.push(...await Promise.all(chunk.map((item) => fn(item))));
  }
  return results;
}

/**
 * Per-run cache of `getBookUserInfo`, keyed by wallet. One publisher usually owns many
 * books, so the payout loop would otherwise re-read the same user doc once per book.
 * Holds the in-flight promise, not the resolved value, so concurrent payouts for the same
 * wallet share a single read instead of racing to issue their own.
 */
type WalletUserInfoCache = Map<string, ReturnType<typeof getBookUserInfo>>;

function getCachedBookUserInfo(wallet: string, cache: WalletUserInfoCache) {
  const cached = cache.get(wallet);
  if (cached) return cached;
  const pending = getBookUserInfo(wallet);
  cache.set(wallet, pending);
  return pending;
}

/**
 * Pays one payee its share of a book for the period, returning how it resolved.
 * - dryRun: reports already-paid as skipped, else classifies by Connect-readiness, without
 *   writing or transferring.
 * - already-paid (same period+book): skipped (idempotent re-run).
 * - not Connect-ready or transfer failed: carried forward as `pending` for a later run.
 * - otherwise: a Stripe Connect transfer (idempotency-keyed) + a `paid` payout record.
 */
async function settleWalletPayout({
  periodId, book, wallet, walletCents, dryRun, userInfoCache,
}: {
  periodId: string;
  book: BookUsage;
  wallet: string;
  walletCents: number;
  dryRun: boolean;
  userInfoCache: WalletUserInfoCache;
}): Promise<PayoutOutcome> {
  const payoutDocRef = likeNFTBookUserCollection
    .doc(wallet)
    .collection('plusReadingPayouts')
    .doc(`${periodId}_${book.classId}`);
  // Two-layer idempotency: this `paid` record skips re-processing on a clean re-run,
  // and the Stripe idempotencyKey below is the real backstop — if a transfer succeeded
  // but its Firestore write failed, the retry reuses the same transfer (no double pay).
  // Checked before the user-info read and the dryRun return so a preview, and a re-run over
  // an already-paid split, both short-circuit without the extra Firestore read.
  const existing = await payoutDocRef.get();
  if (existing.exists && existing.data()?.status === 'paid') return 'skipped';

  const userInfo = await getCachedBookUserInfo(wallet, userInfoCache);
  const isReady = !!userInfo?.isStripeConnectReady && !!userInfo.stripeConnectAccountId;

  if (dryRun) return isReady ? 'paid' : 'pending';

  const baseRecord = {
    periodId,
    classId: book.classId,
    wallet,
    amountCents: walletCents,
    currency: 'usd',
    readingTimeMs: book.readingTimeMs,
    ttsTimeMs: book.ttsTimeMs,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!userInfo?.isStripeConnectReady || !userInfo.stripeConnectAccountId) {
    // Carry forward: hold until the payee finishes Stripe Connect onboarding.
    await payoutDocRef.set({ ...baseRecord, status: 'pending' }, { merge: true });
    return 'pending';
  }
  const { stripeConnectAccountId } = userInfo;

  // Pool-funded transfer from the platform balance — no source_transaction (unlike a
  // per-charge commission). Idempotency key makes a re-run reuse the same transfer.
  const transfer = await getStripeClient().transfers.create({
    amount: walletCents,
    currency: 'usd',
    destination: stripeConnectAccountId,
    transfer_group: `plus-revshare-${periodId}`,
    description: `Plus reading revenue share ${periodId} (${book.classId})`,
    metadata: {
      type: 'plusReadingRevShare',
      periodId,
      classId: book.classId,
      wallet,
    },
  }, {
    idempotencyKey: `plus-revshare-${periodId}-${book.classId}-${wallet}`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Plus reading revshare transfer failed for ${wallet} (${book.classId}):`, err);
    return null;
  });

  if (!transfer) {
    await payoutDocRef.set({ ...baseRecord, status: 'pending' }, { merge: true });
    return 'pending';
  }
  await payoutDocRef.set({
    ...baseRecord,
    status: 'paid',
    transferId: transfer.id,
    stripeConnectAccountId,
  }, { merge: true });
  return 'paid';
}

/**
 * Reads the payable books' docs. A book with no doc maps to `undefined` — the caller skips
 * its usage.
 */
async function getBookDataByClassId(
  classIds: string[],
): Promise<Map<string, NFTBookListingInfo | undefined>> {
  const snaps = await mapInChunks(classIds, (classId) => likeNFTBookCollection.doc(classId).get());
  const bookDataByClassId = new Map<string, NFTBookListingInfo | undefined>();
  snaps.forEach((snap, index) => bookDataByClassId.set(classIds[index], snap.data()));
  return bookDataByClassId;
}

/**
 * Settles each payout, returning the outcomes in `payouts` order. Fail-fast: a Firestore
 * error aborts the run, leaving the period uncompleted so a re-run resumes it (already-paid
 * splits short-circuit, and the Stripe idempotency key covers a transfer whose write was
 * lost). The user-info cache lives for one run, so a payee's Connect status is read fresh
 * each time.
 */
function settleWalletPayouts(
  payouts: WalletPayout[],
  { dryRun }: { dryRun: boolean },
): Promise<PayoutOutcome[]> {
  const userInfoCache: WalletUserInfoCache = new Map();
  return mapInChunks(payouts, ({
    periodId, book, wallet, walletCents,
  }) => settleWalletPayout({
    periodId, book, wallet, walletCents, dryRun, userInfoCache,
  }));
}

/**
 * Settles the Plus reading-library revenue share for one period — a whole month (`YYYY-MM`)
 * or a single day (`YYYY-MM-DD`): accrues the funding pool, freezes the usage snapshot,
 * prices each book, and pays its payees via Stripe Connect (carrying forward anyone not yet
 * Connect-ready). `dryRun` computes and returns the full allocation without writing or
 * transferring. Idempotent and non-overlapping: a completed or overlapping period is refused,
 * a window whose last day hasn't elapsed is refused, and per-payout records guard against
 * double payment on re-run.
 */
export async function settlePlusReadingPeriod({
  periodId,
  dryRun,
  mode,
}: {
  periodId: string;
  dryRun: boolean;
  mode?: PlusReadingAllocationMode;
}) {
  const configDocRef = configCollection.doc(PLUS_READING_REVSHARE_CONFIG_DOC_ID);
  const periodsCol = configDocRef.collection('periods');
  const periodDocRef = periodsCol.doc(periodId);
  const [configSnap, periodSnap] = await Promise.all([configDocRef.get(), periodDocRef.get()]);

  if (!dryRun && periodSnap.exists && periodSnap.data()?.status === 'completed') {
    throw new ValidationError('PLUS_SETTLE_PERIOD_ALREADY_COMPLETED', 409);
  }

  const { startMs, endMs } = getPeriodBoundsMs(periodId);
  // Refuse to settle a window whose last day hasn't fully elapsed — it could still receive
  // usage that the completed + overlap guards would then lock out. A dry run may still
  // preview an in-progress day.
  if (!dryRun && endMs > Date.now()) {
    throw new ValidationError('PLUS_SETTLE_PERIOD_NOT_ENDED', 400);
  }
  // Refuse a window overlapping an already-settled period: settling both a day and the month
  // containing it would pay the overlap twice (different periodId → different idempotency
  // keys). Each completed period stores its [startMs, endMs) for this interval test.
  if (!dryRun) {
    const completedSnap = await periodsCol.where('status', '==', 'completed').get();
    const hasOverlap = completedSnap.docs.some((d) => {
      if (d.id === periodId) return false;
      const { startMs: s, endMs: e } = d.data();
      return typeof s === 'number' && typeof e === 'number' && s < endMs && e > startMs;
    });
    if (hasOverlap) throw new ValidationError('PLUS_SETTLE_PERIOD_OVERLAP', 409);
  }

  const cfg = (configSnap.data() || {}) as {
    revShareRate?: number;
    mode?: PlusReadingAllocationMode;
    readRatePerMinUSD?: number;
    ttsRatePerMinUSD?: number;
    readShare?: number;
    readWeight?: number;
    ttsWeight?: number;
  };
  // Reject a malformed config doc (NaN / Infinity / out-of-range) before money math.
  const revShareRate = configNumber(cfg.revShareRate, DEFAULT_REVSHARE_RATE, 0, 1);
  // Default to `static` ($0.01/min): we pay a fixed per-minute rate and treat the
  // rev-share cut as a target to watch, not a hard pool divisor. An unrecognized stored
  // mode (config doc isn't schema-validated) falls back to `static` rather than misprice.
  const requestedMode = mode || cfg.mode;
  const resolvedMode: PlusReadingAllocationMode = requestedMode
    && PLUS_READING_ALLOCATION_MODES.includes(requestedMode) ? requestedMode : 'static';
  const allocConfig: PlusReadingAllocationConfig = {
    mode: resolvedMode,
    readRatePerMinUSD: cfg.readRatePerMinUSD,
    ttsRatePerMinUSD: cfg.ttsRatePerMinUSD,
    readShare: cfg.readShare,
    readWeight: cfg.readWeight,
    ttsWeight: cfg.ttsWeight,
  };

  // Pool: sum each accrual term's USD overlap with the settlement window. Push the
  // currentPeriodEnd > startMs bound server-side; the other half (currentPeriodStart < endMs)
  // is a second field, so it stays an in-memory filter.
  const accrualSnap = await db.collectionGroup('plusReadingAccrual')
    .where('currentPeriodEnd', '>', startMs)
    .get();
  const accruals = accrualSnap.docs
    .map((doc) => doc.data() as PlusReadingAccrualData)
    .filter((a) => a.currentPeriodStart < endMs);
  const poolUSD = accruePoolUSD(accruals, startMs, endMs);
  const allocatableUSD = poolUSD * revShareRate;

  // Freeze the window's per-book usage snapshot: sum every daily rollup whose `dayMs` falls in
  // [startMs, endMs) per book (a month sums its days; a single day reads one doc). Both bounds
  // are on `dayMs` so the range pushes server-side (needs a `dayMs` collection-group index).
  const usageSnap = await db.collectionGroup('plusUsage')
    .where('dayMs', '>=', startMs)
    .where('dayMs', '<', endMs)
    .get();
  const usageByClass = new Map<string, BookUsage>();
  for (const doc of usageSnap.docs) {
    const data = doc.data() || {};
    const classId = doc.ref.parent.parent?.id || '';
    if (!classId) continue;
    const acc = usageByClass.get(classId) || { classId, readingTimeMs: 0, ttsTimeMs: 0 };
    acc.readingTimeMs += data.readingTimeMs || 0;
    acc.ttsTimeMs += data.ttsTimeMs || 0;
    usageByClass.set(classId, acc);
  }
  const bookUsages: BookUsage[] = [...usageByClass.values()]
    .filter((b) => b.readingTimeMs > 0 || b.ttsTimeMs > 0);

  const totals = bookUsages.reduce(
    (acc, b) => ({
      readingTimeMs: acc.readingTimeMs + b.readingTimeMs,
      ttsTimeMs: acc.ttsTimeMs + b.ttsTimeMs,
    }),
    { readingTimeMs: 0, ttsTimeMs: 0 },
  );
  const rates = computePlusReadingRates(allocatableUSD, totals, allocConfig);

  // Round each book down: per-book rounding then never sums past the pool (under the
  // pool modes), so we can't overpay from the platform balance. The sub-cent dust just
  // stays unallocated. Sub-cent allocations floor to 0 and are skipped below.
  const books: Array<BookUsage & { amountCents: number }> = bookUsages.map((book) => ({
    ...book,
    amountCents: Math.floor(allocateBookUSD(rates, book) * 100),
  }));
  const payableBooks = books.filter((b) => b.amountCents > 0);
  const bookDataByClassId = await getBookDataByClassId(payableBooks.map((b) => b.classId));

  // Resolved in book order, so the skip warnings below stay deterministic even though the
  // transfers themselves run concurrently.
  const payouts: WalletPayout[] = [];
  for (const book of payableBooks) {
    const bookData = bookDataByClassId.get(book.classId);
    if (!bookData) continue; // usage with no book doc — skip
    const hasConnected = bookData.connectedWallets
      && Object.keys(bookData.connectedWallets).length > 0;
    if (!hasConnected && !bookData.ownerWallet) {
      // No resolvable payee — skip rather than synthesize a `{ '': 1 }` split that would
      // write to an empty doc id. The amount stays unallocated (surfaced in the log).
      // eslint-disable-next-line no-console
      console.warn(`Plus settle ${periodId}: ${book.classId} has usage but no payee; skipping`);
      continue;
    }
    const connectedWallets = hasConnected
      ? bookData.connectedWallets
      : { [bookData.ownerWallet]: 1 };

    const splits = splitAmountToWallets(book.amountCents, connectedWallets);
    if (splits.length === 0) {
      // connectedWallets present but no positive weight — surface rather than silently
      // drop it. The amount (guaranteed > 0 above) stays unallocated, like the no-payee case.
      // eslint-disable-next-line no-console
      console.warn(`Plus settle ${periodId}: ${book.classId} has connectedWallets but no positive weight; skipping`);
      continue;
    }
    for (const { wallet, amountCents: walletCents } of splits) {
      payouts.push({
        periodId, book, wallet, walletCents,
      });
    }
  }

  const outcomes = await settleWalletPayouts(payouts, { dryRun });

  let paidCount = 0;
  let pendingCount = 0;
  let paidCents = 0;
  let pendingCents = 0;
  outcomes.forEach((outcome, index) => {
    const { walletCents } = payouts[index];
    if (outcome === 'paid') {
      paidCount += 1;
      paidCents += walletCents;
    } else if (outcome === 'pending') {
      pendingCount += 1;
      pendingCents += walletCents;
    }
  });

  // What we actually pay out this period (pre cent-rounding), and how it compares to
  // the Plus revenue it draws from. Under `static` the rate is fixed, so this fraction
  // floats with usage — log it to watch it against the rev-share target (e.g. 30%).
  const allocatedUSD = allocateBookUSD(rates, totals);
  const revSharePct = poolUSD > 0 ? allocatedUSD / poolUSD : 0;
  // eslint-disable-next-line no-console
  console.log(`Plus settle ${periodId} [${allocConfig.mode}]: paying $${allocatedUSD.toFixed(2)} = ${(revSharePct * 100).toFixed(1)}% of $${poolUSD.toFixed(2)} Plus revenue (rev-share target ${(revShareRate * 100).toFixed(0)}%)`);

  const summary = {
    periodId,
    mode: allocConfig.mode,
    revShareRate,
    poolUSD,
    allocatableUSD,
    allocatedUSD,
    revSharePct,
    readRatePerMin: rates.readRatePerMin,
    ttsRatePerMin: rates.ttsRatePerMin,
    totalReadingTimeMs: totals.readingTimeMs,
    totalTTSTimeMs: totals.ttsTimeMs,
    bookCount: books.length,
    paidCount,
    pendingCount,
    paidCents,
    pendingCents,
  };

  if (!dryRun) {
    await periodDocRef.set({
      ...summary,
      startMs,
      endMs,
      status: 'completed',
      settledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return { dryRun, ...summary, books };
}

/**
 * Re-attempts payouts left `pending` by earlier runs — typically payees who have since
 * completed Stripe Connect onboarding (or whose earlier transfer failed). Reuses
 * settleWalletPayouts with the same idempotency keys, so a payout that already went through
 * is never double-paid. `dryRun` classifies without writing or transferring. Run on its
 * own cadence, independent of the monthly period settle.
 */
export async function sweepPlusReadingPendingPayouts({ dryRun }: { dryRun: boolean }) {
  // Only pending payouts need re-attempting — filter server-side rather than scanning every
  // historical payout doc (needs a single-field `status` collection-group index).
  const snap = await db.collectionGroup('plusReadingPayouts')
    .where('status', '==', 'pending')
    .get();
  const pending = snap.docs
    .map((doc) => doc.data())
    .filter((p) => p.wallet && p.classId && p.periodId);

  // Each record carries its own periodId, so a sweep settles payouts across many periods.
  const payouts: WalletPayout[] = pending
    .map((p) => ({
      periodId: String(p.periodId),
      book: {
        classId: String(p.classId),
        readingTimeMs: Number(p.readingTimeMs) || 0,
        ttsTimeMs: Number(p.ttsTimeMs) || 0,
      },
      wallet: String(p.wallet),
      walletCents: Number(p.amountCents) || 0,
    }))
    .filter((p) => p.walletCents > 0);

  const outcomes = await settleWalletPayouts(payouts, { dryRun });

  let paidCount = 0;
  let stillPendingCount = 0;
  let paidCents = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome === 'paid') {
      paidCount += 1;
      paidCents += payouts[index].walletCents;
    } else if (outcome === 'pending') {
      stillPendingCount += 1;
    }
  });

  return {
    dryRun,
    sweptCount: pending.length,
    paidCount,
    stillPendingCount,
    paidCents,
  };
}
