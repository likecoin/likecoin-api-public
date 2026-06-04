/* eslint-disable no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-continue, import/prefer-default-export */
import {
  FieldValue, db, configCollection, likeNFTBookCollection, likeNFTBookUserCollection,
} from '../../firebase';
import { getStripeClient } from '../../stripe';
import { getBookUserInfo } from '../likernft/book/user';
import { ValidationError } from '../../ValidationError';
import { accruePoolUSD, getUsageMonthBoundsMs } from './revenueShare';
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
 * Settles the Plus reading-library revenue share for one `YYYY-MM` period: accrues the
 * funding pool, freezes the usage snapshot, prices each book, and pays its payees via
 * Stripe Connect (carrying forward anyone not yet Connect-ready). `dryRun` computes and
 * returns the full allocation without writing or transferring. Idempotent: a completed
 * period is refused, and per-payout records guard against double payment on re-run.
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
  const periodDocRef = configDocRef.collection('periods').doc(periodId);
  const [configSnap, periodSnap] = await Promise.all([configDocRef.get(), periodDocRef.get()]);

  if (!dryRun && periodSnap.exists && periodSnap.data()?.status === 'completed') {
    throw new ValidationError('PLUS_SETTLE_PERIOD_ALREADY_COMPLETED', 409);
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

  // Pool: sum each accrual term's USD overlap with the settlement month. Full
  // collection-group scan (monthly batch) — bound with an index on currentPeriodEnd
  // if the accrual ledger grows large.
  const { startMs, endMs } = getUsageMonthBoundsMs(periodId);
  const accrualSnap = await db.collectionGroup('plusReadingAccrual').get();
  const accruals = accrualSnap.docs
    .map((doc) => doc.data() as PlusReadingAccrualData)
    .filter((a) => a.currentPeriodStart < endMs && a.currentPeriodEnd > startMs);
  const poolUSD = accruePoolUSD(accruals, periodId);
  const allocatableUSD = poolUSD * revShareRate;

  // Freeze the period's per-book usage snapshot.
  const usageSnap = await db.collectionGroup('plusUsage').get();
  const bookUsages: BookUsage[] = usageSnap.docs
    .filter((doc) => doc.id === periodId)
    .map((doc) => {
      const data = doc.data() || {};
      return {
        classId: doc.ref.parent.parent?.id || '',
        readingTimeMs: data.readingTimeMs || 0,
        ttsTimeMs: data.ttsTimeMs || 0,
      };
    })
    .filter((b) => b.classId && (b.readingTimeMs > 0 || b.ttsTimeMs > 0));

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
      status: 'completed',
      settledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return { dryRun, ...summary, books };
}
