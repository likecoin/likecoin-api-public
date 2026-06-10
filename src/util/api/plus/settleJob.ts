/* eslint-disable no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-continue, import/prefer-default-export */
import {
  FieldValue, db, configCollection, likeNFTBookCollection, likeNFTBookUserCollection,
} from '../../firebase';
import { getStripeClient } from '../../stripe';
import { getBookUserInfo } from '../likernft/book/user';
import { ValidationError } from '../../ValidationError';
import { accruePoolUSD, getPeriodBoundsMs } from './revenueShare';
import {
  PLUS_READING_ALLOCATION_MODES, allocateBookUSD, computePlusReadingRates, configNumber,
  splitAmountToWallets,
} from './settle';
import type { PlusReadingAllocationConfig, PlusReadingAllocationMode } from './settle';
import type { PlusReadingAccrualData } from '../../../types/user';

const REVSHARE_CONFIG_DOC_ID = 'plusReadingRevShare';
const DEFAULT_REVSHARE_RATE = 0.3;

interface BookUsage {
  classId: string;
  readingTimeMs: number;
  ttsTimeMs: number;
}

type PayoutOutcome = 'paid' | 'pending' | 'skipped';

/**
 * Pays one payee its share of a book for the period, returning how it resolved.
 * - dryRun: reports already-paid as skipped, else classifies by Connect-readiness, without
 *   writing or transferring.
 * - already-paid (same period+book): skipped (idempotent re-run).
 * - not Connect-ready or transfer failed: carried forward as `pending` for a later run.
 * - otherwise: a Stripe Connect transfer (idempotency-keyed) + a `paid` payout record.
 */
async function settleWalletPayout({
  periodId, book, wallet, walletCents, dryRun,
}: {
  periodId: string;
  book: BookUsage;
  wallet: string;
  walletCents: number;
  dryRun: boolean;
}): Promise<PayoutOutcome> {
  const userInfo = await getBookUserInfo(wallet);
  const isReady = !!userInfo?.isStripeConnectReady && !!userInfo.stripeConnectAccountId;

  const payoutDocRef = likeNFTBookUserCollection
    .doc(wallet)
    .collection('plusReadingPayouts')
    .doc(`${periodId}_${book.classId}`);
  // Two-layer idempotency: this `paid` record skips re-processing on a clean re-run,
  // and the Stripe idempotencyKey below is the real backstop — if a transfer succeeded
  // but its Firestore write failed, the retry reuses the same transfer (no double pay).
  // Checked before the dryRun return so a preview also reports already-paid as skipped.
  const existing = await payoutDocRef.get();
  if (existing.exists && existing.data()?.status === 'paid') return 'skipped';

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
  const configDocRef = configCollection.doc(REVSHARE_CONFIG_DOC_ID);
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

  let paidCount = 0;
  let pendingCount = 0;
  let paidCents = 0;
  let pendingCents = 0;
  const books: Array<BookUsage & { amountCents: number }> = [];

  for (const book of bookUsages) {
    // Round each book down: per-book rounding then never sums past the pool (under the
    // pool modes), so we can't overpay from the platform balance. The sub-cent dust just
    // stays unallocated. Sub-cent allocations floor to 0 and are skipped below.
    const amountCents = Math.floor(allocateBookUSD(rates, book) * 100);
    books.push({ ...book, amountCents });
    if (amountCents <= 0) continue;

    const bookData = (await likeNFTBookCollection.doc(book.classId).get()).data();
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

    const splits = splitAmountToWallets(amountCents, connectedWallets);
    if (splits.length === 0) {
      // connectedWallets present but no positive weight — surface rather than silently
      // drop it. The amount (guaranteed > 0 above) stays unallocated, like the no-payee case.
      // eslint-disable-next-line no-console
      console.warn(`Plus settle ${periodId}: ${book.classId} has connectedWallets but no positive weight; skipping`);
      continue;
    }
    for (const { wallet, amountCents: walletCents } of splits) {
      const outcome = await settleWalletPayout({
        periodId, book, wallet, walletCents, dryRun,
      });
      if (outcome === 'paid') {
        paidCount += 1;
        paidCents += walletCents;
      } else if (outcome === 'pending') {
        pendingCount += 1;
        pendingCents += walletCents;
      }
    }
  }

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
 * settleWalletPayout with the same idempotency key, so a payout that already went through
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

  let paidCount = 0;
  let stillPendingCount = 0;
  let paidCents = 0;
  for (const p of pending) {
    const walletCents = Number(p.amountCents) || 0;
    if (walletCents <= 0) continue;
    const book = {
      classId: String(p.classId),
      readingTimeMs: Number(p.readingTimeMs) || 0,
      ttsTimeMs: Number(p.ttsTimeMs) || 0,
    };
    const outcome = await settleWalletPayout({
      periodId: String(p.periodId),
      book,
      wallet: String(p.wallet),
      walletCents,
      dryRun,
    });
    if (outcome === 'paid') {
      paidCount += 1;
      paidCents += walletCents;
    } else if (outcome === 'pending') {
      stillPendingCount += 1;
    }
  }

  return {
    dryRun,
    sweptCount: pending.length,
    paidCount,
    stillPendingCount,
    paidCents,
  };
}
