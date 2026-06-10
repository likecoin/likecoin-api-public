import { configCollection, likeNFTBookUserCollection } from '../../firebase';
import { PLUS_READING_REVSHARE_CONFIG_DOC_ID } from './revenueShare';

export interface PlusReadingReportEntry {
  periodId: string;
  classId: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'pending';
  readingTimeMs: number;
  ttsTimeMs: number;
  readRatePerMin: number;
  ttsRatePerMin: number;
  transferId?: string;
  updatedAt?: number;
}

export interface PlusReadingReport {
  payouts: PlusReadingReportEntry[];
  summary: {
    totalCents: number;
    paidCents: number;
    pendingCents: number;
    periodCount: number;
    bookCount: number;
  };
}

/**
 * Builds a publisher/author's Plus reading-library revenue-share report from their own
 * payout ledger (`likeNFTBookUserCollection/{wallet}/plusReadingPayouts`). The settle job
 * denormalizes each payout with its per-book durations and amount, so this needs only the
 * wallet's own subtree — plus a small join to each settled period's summary for the
 * period-global unit rates ($/min). Sorted newest period first, then by book.
 */
export async function getPlusReadingReportForWallet(
  wallet: string,
  { periodId }: { periodId?: string } = {},
): Promise<PlusReadingReport> {
  const payoutsCol = likeNFTBookUserCollection
    .doc(wallet)
    .collection('plusReadingPayouts');
  // periodId is denormalized onto every payout doc by the settle job, so push the filter
  // server-side instead of reading the wallet's whole ledger and dropping most in memory.
  const snap = await (periodId ? payoutsCol.where('periodId', '==', periodId) : payoutsCol).get();

  const entries: PlusReadingReportEntry[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      periodId: String(data.periodId),
      classId: String(data.classId),
      amountCents: Number(data.amountCents) || 0,
      currency: data.currency || 'usd',
      status: data.status === 'paid' ? 'paid' : 'pending',
      readingTimeMs: Number(data.readingTimeMs) || 0,
      ttsTimeMs: Number(data.ttsTimeMs) || 0,
      readRatePerMin: 0,
      ttsRatePerMin: 0,
      transferId: data.transferId || undefined,
      updatedAt: data.updatedAt?.toMillis?.() ?? undefined,
    };
  });

  // Join period-global unit rates from each settled period summary (few docs — one per month).
  const periodsCol = configCollection
    .doc(PLUS_READING_REVSHARE_CONFIG_DOC_ID)
    .collection('periods');
  const periodIds = [...new Set(entries.map((e) => e.periodId))];
  const rateMap = new Map<string, { readRatePerMin: number; ttsRatePerMin: number }>();
  await Promise.all(periodIds.map(async (pid) => {
    const data = (await periodsCol.doc(pid).get()).data();
    if (data) {
      rateMap.set(pid, {
        readRatePerMin: Number(data.readRatePerMin) || 0,
        ttsRatePerMin: Number(data.ttsRatePerMin) || 0,
      });
    }
  }));

  const payouts = entries
    .map((e) => ({ ...e, ...(rateMap.get(e.periodId) || {}) }))
    .sort((a, b) => (a.periodId === b.periodId
      ? a.classId.localeCompare(b.classId)
      : b.periodId.localeCompare(a.periodId)));

  const summary = payouts.reduce(
    (acc, p) => {
      acc.totalCents += p.amountCents;
      if (p.status === 'paid') acc.paidCents += p.amountCents;
      else acc.pendingCents += p.amountCents;
      return acc;
    },
    { totalCents: 0, paidCents: 0, pendingCents: 0 },
  );

  return {
    payouts,
    summary: {
      ...summary,
      periodCount: new Set(payouts.map((p) => p.periodId)).size,
      bookCount: new Set(payouts.map((p) => p.classId)).size,
    },
  };
}
