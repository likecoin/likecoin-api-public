import type { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';
import { ValidationError } from '../../../ValidationError';
import {
  Timestamp,
  db,
  likeNFTBookCollection,
} from '../../../firebase';

export const BOOK_SALES_COUNT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const PAID_SALE_TX_STATUSES = new Set(['paid', 'pendingNFT', 'completed']);

const TX_QUERY_CONCURRENCY = 20;
const WRITE_BATCH_LIMIT = 500;
const SEED_PAGE_SIZE = 500;

// Sum paid-sale quantities in the window from a book's own transactions subcollection.
// Free claims (priceInDecimal 0) are excluded so free titles don't dominate bestselling.
async function countBookSalesInWindow(classId: string, windowStart: FirestoreTimestamp) {
  const snapshot = await likeNFTBookCollection
    .doc(classId)
    .collection('transactions')
    .where('timestamp', '>=', windowStart)
    .get();
  let total = 0;
  snapshot.docs.forEach((doc) => {
    const { status, quantity = 1, priceInDecimal = 0 } = doc.data() as {
      status?: string;
      quantity?: number;
      priceInDecimal?: number;
    };
    if (!status || !PAID_SALE_TX_STATUSES.has(status)) return;
    if (!(priceInDecimal > 0)) return;
    const parsedQuantity = Number(quantity);
    total += parsedQuantity > 0 ? parsedQuantity : 1;
  });
  return total;
}

export async function refreshBookSalesCounts({
  seedMissing = false,
  dryRun = false,
}: {
  seedMissing?: boolean;
  dryRun?: boolean;
} = {}) {
  const windowStart = Timestamp.fromMillis(Date.now() - BOOK_SALES_COUNT_WINDOW_MS);
  const [activeSnapshot, decayingSnapshot] = await Promise.all([
    likeNFTBookCollection.where('lastSaleTimestamp', '>=', windowStart).get(),
    likeNFTBookCollection.where('salesCount30d', '>', 0).get(),
  ]);

  const countByClassId = new Map<string, number>();
  const activeDocs = activeSnapshot.docs;
  for (let i = 0; i < activeDocs.length; i += TX_QUERY_CONCURRENCY) {
    const chunk = activeDocs.slice(i, i + TX_QUERY_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const counts = await Promise.all(
      chunk.map((doc) => countBookSalesInWindow(doc.id, windowStart)),
    );
    chunk.forEach((doc, index) => countByClassId.set(doc.id, counts[index]));
  }

  const pendingValueByClassId = new Map<string, number>();
  activeDocs.forEach((doc) => {
    const value = countByClassId.get(doc.id) || 0;
    if (doc.data().salesCount30d !== value) pendingValueByClassId.set(doc.id, value);
  });
  decayingSnapshot.docs.forEach((doc) => {
    if (!countByClassId.has(doc.id)) pendingValueByClassId.set(doc.id, 0);
  });
  const updated = pendingValueByClassId.size;

  let seeded = 0;
  if (seedMissing) {
    let lastDoc;
    for (;;) {
      let query = likeNFTBookCollection.orderBy('__name__').limit(SEED_PAGE_SIZE);
      if (lastDoc) query = query.startAfter(lastDoc);
      // eslint-disable-next-line no-await-in-loop
      const pageSnapshot = await query.get();
      if (pageSnapshot.empty) break;
      seeded += pageSnapshot.docs.reduce((count, doc) => {
        if (doc.data().salesCount30d !== undefined || pendingValueByClassId.has(doc.id)) {
          return count;
        }
        pendingValueByClassId.set(doc.id, 0);
        return count + 1;
      }, 0);
      lastDoc = pageSnapshot.docs[pageSnapshot.docs.length - 1];
      if (pageSnapshot.docs.length < SEED_PAGE_SIZE) break;
    }
  }

  if (!dryRun) {
    const entries = Array.from(pendingValueByClassId.entries());
    for (let i = 0; i < entries.length; i += WRITE_BATCH_LIMIT) {
      const batch = db.batch();
      entries.slice(i, i + WRITE_BATCH_LIMIT).forEach(([classId, salesCount30d]) => {
        batch.update(likeNFTBookCollection.doc(classId), { salesCount30d });
      });
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }
  }

  return { scanned: activeDocs.length, updated, seeded };
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
    .orderBy('salesCount30d', 'desc')
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
