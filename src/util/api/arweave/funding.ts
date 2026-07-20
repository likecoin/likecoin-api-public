import {
  getPendingFundingArweaveTxs,
  markArweaveTxFundingCredited,
  setArweaveTxFundingSent,
} from './tx';
import { fund, notifyIrys } from '../../arweave/signer';

export interface ReconcileResult {
  id: string;
  fundingTxHash: string;
  credited: boolean;
  error?: string;
}

// Pass-through funding: forward the user's payment into the Irys balance in the background;
// a standing buffer covers this upload, so nothing waits on confirmation. fundingStatus:'sent'
// persists before notify so reconcile can replay; sponsored uploads (no paidETH) skip this.
export function fundUploadIfNeeded(uploadId: string, paidETH?: string): void {
  if (!paidETH || paidETH === '0') return;
  fund(paidETH, {
    onSent: (h) => setArweaveTxFundingSent(uploadId, { fundingTxHash: h, fundingETH: paidETH }),
  })
    .then(() => markArweaveTxFundingCredited(uploadId).catch(() => undefined))
    .catch((err) => {
      // Deposit send/notify failed. The buffer still covers uploads; the funding tx (if
      // broadcast) stays fundingStatus:'sent' for reconcile to replay. Log so it's visible.
      // eslint-disable-next-line no-console
      console.error(`Irys pass-through funding failed for ${uploadId}:`, (err as Error).message);
    });
}

// Replay upload docs whose Irys funding was sent but never confirmed credited.
// notifyIrys is idempotent (an already-credited tx re-notify succeeds), so this is
// safe to run repeatedly. Sequential to stay gentle on the node; `dryRun` only lists.
export async function reconcilePendingIrysFunding({
  dryRun = false,
  limit = 100,
}: { dryRun?: boolean; limit?: number } = {}): Promise<{
  total: number;
  credited: number;
  results: ReconcileResult[];
}> {
  const pending = await getPendingFundingArweaveTxs(limit);
  const results: ReconcileResult[] = [];
  let consecutiveFailures = 0;
  for (const { id, fundingTxHash } of pending) {
    if (dryRun) {
      results.push({ id, fundingTxHash, credited: false });
      // eslint-disable-next-line no-continue
      continue;
    }
    // The node is likely down; the remaining notifies would fail identically,
    // each after a full retry ladder — bail out and let the next run retry.
    if (consecutiveFailures >= 3) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      await notifyIrys(fundingTxHash);
      // eslint-disable-next-line no-await-in-loop
      await markArweaveTxFundingCredited(id);
      results.push({ id, fundingTxHash, credited: true });
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      results.push({
        id, fundingTxHash, credited: false, error: (err as Error).message,
      });
    }
  }
  return {
    total: pending.length,
    credited: results.filter((r) => r.credited).length,
    results,
  };
}

export default reconcilePendingIrysFunding;
