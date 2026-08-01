import { ValidationError } from '../../../ValidationError';
import { likeNFTBookCollection } from '../../../firebase';
import { ONE_DAY_IN_MS } from '../../../../constant';

// Time-weighted bestselling score: each paid sale adds quantity × 2^(days / halfLife), so
// newer sales are worth exponentially more and the stored score never needs decay — ordering
// stays recency-biased with writes only at purchase time, no cron. A sale today outweighs one
// 30 days ago ~20×. Sale time is floored to the UTC day, so same-day sales weigh the same.
// Epoch-day sales weigh 1, doubling weekly; pre-epoch sales get fractional weights. The
// exponent stays within float64 range until ~2046; rebase the epoch if this outlives that.
export const SALES_SCORE_EPOCH_MS = Date.UTC(2026, 7, 1);
export const SALES_SCORE_HALF_LIFE_DAYS = 7;

export function getSaleScoreIncrement(quantity: number, saleTimeMs: number) {
  const parsedQuantity = Number(quantity);
  // Purchase schemas enforce a positive int; a malformed quantity counts as one sale.
  const count = parsedQuantity > 0 ? parsedQuantity : 1;
  const days = Math.floor((saleTimeMs - SALES_SCORE_EPOCH_MS) / ONE_DAY_IN_MS);
  return count * 2 ** (days / SALES_SCORE_HALF_LIFE_DAYS);
}

export async function listBestsellingNFTBookInfo({
  isPlusReadingEnabled,
  limit,
  key,
}: {
  isPlusReadingEnabled?: boolean;
  limit?: number;
  key?: string;
} = {}) {
  let snapshot = likeNFTBookCollection
    .orderBy('salesScore', 'desc')
    .orderBy('timestamp', 'desc');
  if (isPlusReadingEnabled !== undefined) {
    snapshot = snapshot.where('isPlusReadingEnabled', '==', isPlusReadingEnabled);
  }
  // Document cursor: keeps the `__name__` tiebreak so books tied at 0 sales page without gaps.
  if (key) {
    const cursorDoc = await likeNFTBookCollection.doc(key.toLowerCase()).get();
    if (!cursorDoc.exists) throw new ValidationError('INVALID_KEY', 400);
    snapshot = snapshot.startAfter(cursorDoc);
  }
  if (limit !== undefined) {
    snapshot = snapshot.limit(limit);
  }
  const query = await snapshot.get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}
