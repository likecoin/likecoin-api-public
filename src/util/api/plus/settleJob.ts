/* eslint-disable no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-continue, import/prefer-default-export */
import {
  FieldValue, db, configCollection, likeNFTBookCollection, likeNFTBookUserCollection,
} from '../../firebase';
import { getStripeClient } from '../../stripe';
import { getBookUserInfo } from '../likernft/book/user';
import { ValidationError } from '../../ValidationError';
import { buildCSV } from '../../csv';
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
import type {
  PlusReadingAllocationConfig,
  PlusReadingAllocationMode,
  PlusSettleBookSkipReason,
  PlusSettlePayoutOutcome,
} from './settle';
import type { PlusReadingAccrualData } from '../../../types/user';
import type { NFTBookListingInfo } from '../../../types/book';

const DEFAULT_REVSHARE_RATE = 0.3;

// Margin under Stripe's description cap, so a long title can't fail the transfer.
const MAX_DESCRIPTION_TITLE_LENGTH = 200;

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
  // Title for the transfer description, when the caller already holds the book doc.
  // Left unset (the sweep) it is read lazily — see getCachedBookName.
  bookName?: string;
  wallet: string;
  walletCents: number;
}

// The payout record on file: what an earlier run left, or what this run just wrote (a dry
// run writes nothing, so it always reports the earlier one). Carried out of the payout so
// the caller can report ledger truth — what really transferred — alongside this run's
// recomputed amount, which diverges once the allocation config changes.
interface PayoutLedger {
  status: string;
  amountCents: number;
  transferId?: string;
  updatedAt?: number;
}

interface PayoutResult {
  outcome: PlusSettlePayoutOutcome;
  ledger?: PayoutLedger;
}

// `extends` rather than an intersection: an intersection would silently merge a future
// same-named field on WalletPayout, where this errors on the collision.
interface SettledWalletPayout extends WalletPayout, PayoutResult {}

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
 * Per-run cache of book titles, keyed by classId. Only the transfer description needs the
 * title, so it's read at the last moment — a payout that short-circuits (already paid, dry
 * run, payee not Connect-ready) never reads the book doc. Caches the in-flight promise, so
 * a book split across several payees reads once.
 */
type BookNameCache = Map<string, Promise<string | undefined>>;

function getCachedBookName(classId: string, cache: BookNameCache) {
  const cached = cache.get(classId);
  if (cached) return cached;
  const pending = likeNFTBookCollection.doc(classId).get()
    .then((snap) => (snap.data() as NFTBookListingInfo | undefined)?.name)
    // The title is only a transfer label and falls back to the classId, so a failed read
    // must not abort the payout — nor stay cached as a rejection for the book's other payees.
    .catch(() => undefined);
  cache.set(classId, pending);
  return pending;
}

/**
 * Pays one payee its share of a book for the period, returning how it resolved plus the
 * pre-existing payout record, if any.
 * - dryRun: reports already-paid as `settled`, else classifies by Connect-readiness, without
 *   writing or transferring.
 * - already-paid (same period+book): `settled` (idempotent re-run).
 * - not Connect-ready or transfer failed: carried forward as `pending` for a later run.
 * - otherwise: a Stripe Connect transfer (idempotency-keyed) + a `paid` payout record.
 */
async function settleWalletPayout({
  periodId, book, bookName, wallet, walletCents, dryRun, userInfoCache, bookNameCache,
}: WalletPayout & {
  dryRun: boolean;
  userInfoCache: WalletUserInfoCache;
  bookNameCache: BookNameCache;
}): Promise<PayoutResult> {
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
  const existingData = existing.data();
  const ledger: PayoutLedger | undefined = existingData ? {
    status: String(existingData.status || ''),
    amountCents: Number(existingData.amountCents) || 0,
    transferId: existingData.transferId ? String(existingData.transferId) : undefined,
    updatedAt: existingData.updatedAt?.toMillis?.(),
  } : undefined;
  if (ledger?.status === 'paid') return { outcome: 'settled', ledger };

  const userInfo = await getCachedBookUserInfo(wallet, userInfoCache);
  const isReady = !!userInfo?.isStripeConnectReady && !!userInfo.stripeConnectAccountId;

  if (dryRun) return { outcome: isReady ? 'paid' : 'pending', ledger };

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
    return { outcome: 'pending', ledger: { status: 'pending', amountCents: walletCents } };
  }
  const { stripeConnectAccountId } = userInfo;
  const title = bookName ?? await getCachedBookName(book.classId, bookNameCache);
  // A legacy doc could hold a non-string name — fall back rather than throw mid-transfer.
  const bookLabel = (typeof title === 'string'
    && title.trim().slice(0, MAX_DESCRIPTION_TITLE_LENGTH)) || book.classId;

  // Pool-funded transfer from the platform balance — no source_transaction (unlike a
  // per-charge commission). Idempotency key makes a re-run reuse the same transfer.
  const transfer = await getStripeClient().transfers.create({
    amount: walletCents,
    currency: 'usd',
    destination: stripeConnectAccountId,
    transfer_group: `plus-revshare-${periodId}`,
    description: `Li3rary revenue share ${periodId} (${bookLabel})`,
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
    return { outcome: 'pending', ledger: { status: 'pending', amountCents: walletCents } };
  }
  await payoutDocRef.set({
    ...baseRecord,
    status: 'paid',
    transferId: transfer.id,
    stripeConnectAccountId,
  }, { merge: true });
  // Report the record just written, so a live run's export carries the transfer it made.
  return {
    outcome: 'paid',
    ledger: { status: 'paid', amountCents: walletCents, transferId: transfer.id },
  };
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
 * Settles each payout, returning each one merged with how it resolved, so callers read the
 * amount and the outcome off one row. Fail-fast: a
 * Firestore error aborts the run, leaving the period uncompleted so a re-run resumes it
 * (already-paid splits short-circuit, and the Stripe idempotency key covers a transfer whose
 * write was lost). The user-info cache lives for one run, so a payee's Connect status is read
 * fresh each time.
 */
function settleWalletPayouts(
  payouts: WalletPayout[],
  { dryRun }: { dryRun: boolean },
): Promise<SettledWalletPayout[]> {
  const userInfoCache: WalletUserInfoCache = new Map();
  const bookNameCache: BookNameCache = new Map();
  return mapInChunks(payouts, async (payout) => ({
    ...payout,
    ...await settleWalletPayout({
      ...payout, dryRun, userInfoCache, bookNameCache,
    }),
  }));
}

/**
 * Settles the Plus reading-library revenue share for one period — a whole month (`YYYY-MM`)
 * or a single day (`YYYY-MM-DD`): accrues the funding pool, freezes the usage snapshot,
 * prices each book, and pays its payees via Stripe Connect (carrying forward anyone not yet
 * Connect-ready). `dryRun` computes and returns the full allocation without writing or
 * transferring, so re-running it over a completed period doubles as a review of what that
 * period paid. `includePayouts` adds the per-(book, wallet) rows; off by default so the
 * cron's response stays small. Idempotent: a completed or overlapping period is refused,
 * a window whose last day hasn't elapsed is refused, and per-payout records guard against
 * double payment on re-run.
 */
export async function settlePlusReadingPeriod({
  periodId,
  dryRun,
  mode,
  includePayouts = false,
}: {
  periodId: string;
  dryRun: boolean;
  mode?: PlusReadingAllocationMode;
  includePayouts?: boolean;
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

  // Unique library readers, from the per-reader grain under each day rollup in the window
  // (ID-only listings, no doc reads). Reader docs exist only for payout-eligible usage,
  // so this undercounts vs publisher engagement stats that include non-library reads.
  // A zero-library-time rollup can't have reader docs (ingest gates the reader write on
  // library time), so skip its listing round trip.
  const readerDayDocs = usageSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    return (data.readingTimeMs || 0) > 0 || (data.ttsTimeMs || 0) > 0;
  });
  const readerLists = await mapInChunks(readerDayDocs, async (doc) => ({
    classId: doc.ref.parent.parent?.id || '',
    refs: await doc.ref.collection('readers').listDocuments(),
  }));
  const readersByClass = new Map<string, Set<string>>();
  const allReaders = new Set<string>();
  readerLists.forEach(({ classId, refs }) => {
    if (!classId) return;
    const readers = readersByClass.get(classId) || new Set<string>();
    refs.forEach(({ id }) => {
      readers.add(id);
      allReaders.add(id);
    });
    readersByClass.set(classId, readers);
  });

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
  // A reader of N books counts once per book, so per-book readerCounts can sum past
  // the summary's unique readerCount.
  const books: Array<BookUsage & { amountCents: number; readerCount: number }> = bookUsages
    .map((book) => ({
      ...book,
      amountCents: Math.floor(allocateBookUSD(rates, book) * 100),
      readerCount: readersByClass.get(book.classId)?.size || 0,
    }));
  const payableBooks = books.filter((b) => b.amountCents > 0);
  const bookDataByClassId = await getBookDataByClassId(payableBooks.map((b) => b.classId));

  // Reported per book so unallocated money stays reviewable in the response, not just in
  // the warnings below.
  const skipReasonByClass = new Map<string, PlusSettleBookSkipReason>();
  books.forEach((b) => {
    if (b.amountCents <= 0) skipReasonByClass.set(b.classId, 'belowCent');
  });

  // Resolved in book order, so the skip warnings below stay deterministic even though the
  // transfers themselves run concurrently.
  const payouts: WalletPayout[] = [];
  for (const book of payableBooks) {
    const bookData = bookDataByClassId.get(book.classId);
    if (!bookData) {
      // usage with no book doc — no payee to resolve
      skipReasonByClass.set(book.classId, 'noPayee');
      continue;
    }
    const hasConnected = bookData.connectedWallets
      && Object.keys(bookData.connectedWallets).length > 0;
    if (!hasConnected && !bookData.ownerWallet) {
      // No resolvable payee — skip rather than synthesize a `{ '': 1 }` split that would
      // write to an empty doc id. The amount stays unallocated (surfaced in the log).
      skipReasonByClass.set(book.classId, 'noPayee');
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
      skipReasonByClass.set(book.classId, 'noPositiveWeight');
      // eslint-disable-next-line no-console
      console.warn(`Plus settle ${periodId}: ${book.classId} has connectedWallets but no positive weight; skipping`);
      continue;
    }
    for (const { wallet, amountCents: walletCents } of splits) {
      payouts.push({
        periodId, book, bookName: bookData.name, wallet, walletCents,
      });
    }
  }

  const results = await settleWalletPayouts(payouts, { dryRun });

  let paidCount = 0;
  let pendingCount = 0;
  let settledCount = 0;
  let paidCents = 0;
  let pendingCents = 0;
  let settledCents = 0;
  // Per-book rollup of the same outcomes, so `books` shows where each book's money landed.
  const rollupByClass = new Map<string, {
    payeeCount: number; paidCents: number; pendingCents: number; settledCents: number;
  }>();
  results.forEach(({
    outcome, ledger, book, walletCents,
  }) => {
    const roll = rollupByClass.get(book.classId)
      || {
        payeeCount: 0, paidCents: 0, pendingCents: 0, settledCents: 0,
      };
    roll.payeeCount += 1;
    if (outcome === 'paid') {
      paidCount += 1;
      paidCents += walletCents;
      roll.paidCents += walletCents;
    } else if (outcome === 'pending') {
      pendingCount += 1;
      pendingCents += walletCents;
      roll.pendingCents += walletCents;
    } else {
      // The ledger amount, not this run's `walletCents` — see PayoutLedger.
      const ledgerCents = ledger?.amountCents || 0;
      settledCount += 1;
      settledCents += ledgerCents;
      roll.settledCents += ledgerCents;
    }
    rollupByClass.set(book.classId, roll);
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
    readerCount: allReaders.size,
    paidCount,
    pendingCount,
    settledCount,
    paidCents,
    pendingCents,
    settledCents,
  };

  const bookRows = books.map((book) => {
    const roll = rollupByClass.get(book.classId);
    return {
      ...book,
      payeeCount: roll?.payeeCount || 0,
      paidCents: roll?.paidCents || 0,
      pendingCents: roll?.pendingCents || 0,
      settledCents: roll?.settledCents || 0,
      skipReason: skipReasonByClass.get(book.classId),
    };
  });

  // Per-(book, wallet) grain — the money grain, and what the CSV export rows come from.
  const payoutRows = includePayouts ? results.map(({
    book, wallet, walletCents, outcome, ledger,
  }) => ({
    classId: book.classId,
    wallet,
    amountCents: walletCents,
    outcome,
    readingTimeMs: book.readingTimeMs,
    ttsTimeMs: book.ttsTimeMs,
    ledgerStatus: ledger?.status,
    ledgerAmountCents: ledger?.amountCents,
    transferId: ledger?.transferId,
    updatedAt: ledger?.updatedAt,
  })) : undefined;

  if (!dryRun) {
    await periodDocRef.set({
      ...summary,
      startMs,
      endMs,
      status: 'completed',
      settledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    dryRun, ...summary, books: bookRows, ...(payoutRows ? { payouts: payoutRows } : {}),
  };
}

// Payout grain (one row per book × payee), with the book's columns denormalized onto each
// row so the file needs no join. A book that produced no payout still gets a row, carrying
// its `skipReason` and an empty wallet, so unallocated money can't vanish from the export.
const PLUS_SETTLE_CSV_COLUMNS = [
  'periodId',
  'classId',
  'wallet',
  'amountCents',
  'outcome',
  'ledgerStatus',
  'ledgerAmountCents',
  'transferId',
  'readingTimeMs',
  'ttsTimeMs',
  'bookAmountCents',
  'bookReaderCount',
  'skipReason',
] as const;

// Absent columns render empty, so a row only carries the cells it actually has.
type PlusSettleCSVRow = Partial<Record<typeof PLUS_SETTLE_CSV_COLUMNS[number], string>>;

const csvNum = (value: number | undefined) => (value === undefined ? undefined : String(value));

type PlusSettleResult = Awaited<ReturnType<typeof settlePlusReadingPeriod>>;

/**
 * Serializes a settle result as CSV for offline review. Amounts stay in cents — integers
 * survive a spreadsheet round-trip where fractional dollars wouldn't. `amountCents` is what
 * this run computed and `ledgerAmountCents` what was actually paid, so a re-run over a
 * settled period shows config drift as a column diff. Pass a result produced with
 * `includePayouts`, or every book comes out as a payee-less row.
 */
export function formatPlusSettleCSV(result: PlusSettleResult): string {
  const { periodId } = result;
  const payoutsByClass = new Map<string, NonNullable<typeof result.payouts>>();
  (result.payouts || []).forEach((payout) => {
    const list = payoutsByClass.get(payout.classId) || [];
    list.push(payout);
    payoutsByClass.set(payout.classId, list);
  });

  // Book order, payees grouped under their book — the same order the settle resolved them in.
  const rows: PlusSettleCSVRow[] = [];
  result.books.forEach((book) => {
    const bookColumns = {
      periodId,
      classId: book.classId,
      bookAmountCents: csvNum(book.amountCents),
      bookReaderCount: csvNum(book.readerCount),
    };
    const payouts = payoutsByClass.get(book.classId) || [];
    payouts.forEach((payout) => rows.push({
      ...bookColumns,
      wallet: payout.wallet,
      amountCents: csvNum(payout.amountCents),
      outcome: payout.outcome,
      ledgerStatus: payout.ledgerStatus,
      ledgerAmountCents: csvNum(payout.ledgerAmountCents),
      transferId: payout.transferId,
      readingTimeMs: csvNum(payout.readingTimeMs),
      ttsTimeMs: csvNum(payout.ttsTimeMs),
    }));
    if (!payouts.length) {
      rows.push({ ...bookColumns, skipReason: book.skipReason });
    }
  });

  return buildCSV([...PLUS_SETTLE_CSV_COLUMNS], rows);
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
  // No bookName: the record only stores the classId, so the title is read lazily, and only
  // for the payouts that actually transfer.
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

  const results = await settleWalletPayouts(payouts, { dryRun });

  let paidCount = 0;
  let stillPendingCount = 0;
  let paidCents = 0;
  results.forEach(({ outcome, walletCents }) => {
    if (outcome === 'paid') {
      paidCount += 1;
      paidCents += walletCents;
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
