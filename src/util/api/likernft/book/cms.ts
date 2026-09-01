import type { NFTBookListingInfo, NFTBookCMSTag } from '../../../../types/book';
import { FIRESTORE_QUERY_DISJUNCTION_LIMIT } from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import {
  FieldValue,
  Filter,
  likeNFTBookCollection,
  likeNFTBookCMSTagCollection,
} from '../../../firebase';

// Sync a book's cmsTags against `tagIds`: new ids get order 0,
// missing ids are removed, existing ids keep their `order`.
// Adjust orders separately via `bulkSetNFTBookCMSTagOrder`.
export async function syncNFTBookCMSTagEntries(
  classId: string,
  tagIds: string[],
) {
  const docRef = likeNFTBookCollection.doc(classId);
  const snap = await docRef.get();
  if (!snap.exists) throw new ValidationError('BOOK_NOT_FOUND', 404);
  const data = snap.data() as NFTBookListingInfo;
  const current = data.cmsTags || {};
  const updatedTagIds = new Set(tagIds);

  const payload: any = {
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  };
  updatedTagIds.forEach((tagId) => {
    if (!(tagId in current)) {
      payload[`cmsTags.${tagId}`] = 0;
    }
  });
  Object.keys(current).forEach((tagId) => {
    if (!updatedTagIds.has(tagId)) {
      payload[`cmsTags.${tagId}`] = FieldValue.delete();
    }
  });
  await docRef.update(payload);
}

// Bulk write with best-effort semantics: missing classIds are skipped and returned in
// the `errors` map rather than aborting the whole batch. BULK_LIMIT applies to unique
// classIds after grouping. Each entry's `order` is a number (set) or null (remove);
// duplicates per classId merge.
const BULK_LIMIT = 500;
const BULK_UPDATE_CONCURRENCY = 20;

export async function bulkSetNFTBookCMSTagOrder(
  entries: Array<{ classId: string; tagId: string; order: number | null }>,
) {
  if (!entries.length) return { updated: 0 };
  const payloadByNFTClassId = new Map<string, any>();
  entries.forEach(({ classId, tagId, order }) => {
    const payload = payloadByNFTClassId.get(classId) || {
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    };
    payload[`cmsTags.${tagId}`] = order === null ? FieldValue.delete() : order;
    payloadByNFTClassId.set(classId, payload);
  });
  if (payloadByNFTClassId.size > BULK_LIMIT) {
    throw new ValidationError('BULK_LIMIT_EXCEEDED', 400);
  }
  const classIds = Array.from(payloadByNFTClassId.keys());
  const results: PromiseSettledResult<any>[] = [];
  for (let i = 0; i < classIds.length; i += BULK_UPDATE_CONCURRENCY) {
    const chunk = classIds.slice(i, i + BULK_UPDATE_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const chunkResults = await Promise.allSettled(
      chunk.map((classId) => likeNFTBookCollection.doc(classId)
        .update(payloadByNFTClassId.get(classId))),
    );
    results.push(...chunkResults);
  }
  const errors: Record<string, string> = {};
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const e = result.reason as { code?: number | string; message?: string };
      errors[classIds[i]] = e?.message || String(result.reason);
    }
  });
  const errorCount = Object.keys(errors).length;
  const updated = classIds.length - errorCount;
  return {
    updated,
    ...(errorCount ? { errors } : {}),
  };
}

// Takes only the field it reads, so masked admin docs can use it too.
export function getBookTimestampMillis(book: { timestamp?: unknown }): number {
  const ts: any = book.timestamp;
  return ts?.toMillis?.() ?? (typeof ts === 'number' ? ts : 0);
}

function normalizeConditionNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

// Re-applies the schema's disjunction budget so hand-edited docs can't break queries.
// Costs mirror the query: publisher/author use 2 OR branches (string | { name }),
// genre/keyword use 1. Earlier lists take priority when trimming.
function normalizeConditions(conditions: NFTBookCMSTag['conditions']) {
  let budget = FIRESTORE_QUERY_DISJUNCTION_LIMIT;
  const takeNames = (value: unknown, costPerName: number) => {
    const names = normalizeConditionNames(value).slice(0, Math.floor(budget / costPerName));
    budget -= names.length * costPerName;
    return names;
  };
  return {
    publishers: takeNames(conditions?.publishers, 2),
    authors: takeNames(conditions?.authors, 2),
    genres: takeNames(conditions?.genres, 1),
    keywords: takeNames(conditions?.keywords, 1),
  };
}

// Handpicked books first, then condition-matched books by timestamp desc
async function listNFTBookInfoByCMSTagConditions(
  tagId: string,
  conditions: NonNullable<NFTBookCMSTag['conditions']>,
  { offset, limit }: { offset: number; limit: number },
) {
  const manualSnap = await likeNFTBookCollection
    .where(`cmsTags.${tagId}`, '>=', 0)
    .orderBy(`cmsTags.${tagId}`, 'asc')
    .limit(offset + limit)
    .get();
  const manualBooks = manualSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as NFTBookListingInfo) }))
    .sort((a, b) => (a.cmsTags?.[tagId] ?? 0) - (b.cmsTags?.[tagId] ?? 0));

  // A full result serves the whole page; otherwise it is the complete handpicked list.
  if (manualBooks.length >= offset + limit) return manualBooks.slice(offset, offset + limit);
  const manualIds = new Set(manualBooks.map((b) => b.id));

  // Over-fetch by manualIds.size since duplicates of handpicked books are dropped.
  const queryLimit = (offset + limit - manualBooks.length) + manualIds.size;
  // Contributor fields are `string | { name }`, so each field needs a branch per shape.
  const orFilters: any[] = [];
  ([
    ['publisher', conditions.publishers],
    ['author', conditions.authors],
  ] as [string, string[]][]).forEach(([field, names]) => {
    if (!names.length) return;
    orFilters.push(Filter.where(field, 'in', names));
    orFilters.push(Filter.where(`${field}.name`, 'in', names));
  });
  if (conditions.genres.length) {
    orFilters.push(Filter.where('genre', 'in', conditions.genres));
  }
  if (conditions.keywords.length) {
    orFilters.push(Filter.where('keywords', 'array-contains-any', conditions.keywords));
  }
  const conditionSnap = await likeNFTBookCollection
    .where(Filter.or(...orFilters))
    .orderBy('timestamp', 'desc')
    .limit(queryLimit)
    .get();

  const matchedBooks = conditionSnap.docs
    .filter((doc: any) => !manualIds.has(doc.id))
    .map((doc: any) => ({ id: doc.id, ...(doc.data() as NFTBookListingInfo) }))
    .sort((a: any, b: any) => getBookTimestampMillis(b) - getBookTimestampMillis(a));

  return [...manualBooks, ...matchedBooks].slice(offset, offset + limit);
}

export async function listNFTBookInfoByCMSTag(
  tagId: string,
  {
    offset = 0,
    limit = 10,
    conditions,
  }: {
    offset?: number;
    limit?: number;
    conditions?: NFTBookCMSTag['conditions'];
  } = {},
) {
  const normalizedConditions = normalizeConditions(conditions);
  if (Object.values(normalizedConditions).some((names) => names.length)) {
    return listNFTBookInfoByCMSTagConditions(tagId, normalizedConditions, { offset, limit });
  }
  // Filter to docs with the tag entry set; orderBy alone misses nested maps.
  // Order values are non-negative ints, so `>= 0` works as an existence check.
  const query = await likeNFTBookCollection
    .where(`cmsTags.${tagId}`, '>=', 0)
    .orderBy(`cmsTags.${tagId}`, 'asc')
    .offset(offset)
    .limit(limit)
    .get();
  return query.docs.map((doc) => ({ id: doc.id, ...(doc.data() as NFTBookListingInfo) }));
}

export async function upsertNFTBookCMSTag(
  tagId: string,
  payload: NFTBookCMSTag,
) {
  const docRef = likeNFTBookCMSTagCollection.doc(tagId);
  const snap = await docRef.get();
  const now = FieldValue.serverTimestamp();
  await docRef.set(
    {
      ...payload,
      ...(snap.exists ? {} : { timestamp: now }),
      lastUpdateTimestamp: now,
    },
    { merge: true },
  );
}

function serializeCMSTagDoc(
  id: string,
  data: NFTBookCMSTag,
) {
  const conditions = normalizeConditions(data.conditions);
  return {
    ...data,
    id,
    conditions,
    isConditional: Object.values(conditions).some((names) => names.length),
    isForLibrary: data.isForLibrary ?? false,
    isForStore: data.isForStore ?? false,
    timestamp: data.timestamp?.toMillis?.() ?? data.timestamp,
    lastUpdateTimestamp: data.lastUpdateTimestamp?.toMillis?.() ?? data.lastUpdateTimestamp,
  };
}

export async function listNFTBookCMSTags() {
  const query = await likeNFTBookCMSTagCollection.orderBy('order', 'asc').get();
  return query.docs.map((doc) => serializeCMSTagDoc(doc.id, doc.data() as NFTBookCMSTag));
}

export async function getNFTBookCMSTag(tagId: string) {
  const snap = await likeNFTBookCMSTagCollection.doc(tagId).get();
  if (!snap.exists) return null;
  return serializeCMSTagDoc(snap.id, snap.data() as NFTBookCMSTag);
}
