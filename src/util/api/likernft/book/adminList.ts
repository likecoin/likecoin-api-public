import type { Query, WhereFilterOp } from 'firebase-admin/firestore';
import { likeNFTBookCollection } from '../../../firebase';
import { isFailedPreconditionError } from '../../../misc';
import { getBookTimestampMillis } from './cms';
import type {
  NFTBookComplianceReviewRecord,
  NFTBookListingInfo,
} from '../../../../types/book';

// Backing the `/book list` admin browser. Only base-chain listings are on the
// live storefront; `chain` is stamped at creation, so legacy `like`-chain books
// stay out of scope entirely.
export const BOOK_LIST_CHAIN = 'base';
export const BOOK_LIST_DEFAULT_LIMIT = 10;
export const BOOK_LIST_MAX_LIMIT = 50;
// Bounds only the inequality branch below; every other filter is paged by the
// index and fetches exactly `limit` docs.
const BOOK_LIST_INEQUALITY_MAX_SCAN = 5000;

// Only what the list renders or filters on. The scan is affordable because of
// this mask — full docs carry descriptions, tables of contents and prices.
const BOOK_LIST_FIELD_MASK = [
  'name',
  'classId',
  'timestamp',
  'minPriceInDecimal',
  'isHidden',
  'isPendingReview',
  'isAdultOnly',
  'restrictedTerritories',
  'isApprovedForSale',
  'isApprovedForIndexing',
  'isApprovedForAds',
  'isPlusReadingEnabled',
  'aiReview',
] as const;

// Derived from the mask, so reading a field the query never selected is a
// compile error rather than an `undefined` that only shows up in production.
export type AdminBookListItem =
  Partial<Pick<NFTBookListingInfo, typeof BOOK_LIST_FIELD_MASK[number]>> & { classId: string };

type BookListFieldPath =
  | keyof NFTBookListingInfo
  | `aiReview.${keyof NFTBookComplianceReviewRecord}`;

type BookListFlagWhere = [BookListFieldPath, WhereFilterOp, unknown];

// Each flag names an exceptional state, so each is one clause on one field. A
// doc missing that field never satisfies it, which is what makes the legacy
// default correct: an unset approval flag means approved, so `== false` skips it.
export const BOOK_LIST_FLAGS = {
  pending: ['isPendingReview', '==', true],
  hidden: ['isHidden', '==', true],
  nosale: ['isApprovedForSale', '==', false],
  noads: ['isApprovedForAds', '==', false],
  noindex: ['isApprovedForIndexing', '==', false],
  geoblocked: ['restrictedTerritories', '!=', null],
  adult: ['isAdultOnly', '==', true],
  plus: ['isPlusReadingEnabled', '==', true],
  aireview: ['aiReview.needsHumanReview', '==', true],
} satisfies Record<string, BookListFlagWhere>;

export type BookListFlag = keyof typeof BOOK_LIST_FLAGS;

// Firestore's own semantics, re-read off a returned doc so a listing can be
// labelled with every flag it exhibits, not just the ones that were queried.
export function matchesBookListFlag(book: AdminBookListItem, flag: BookListFlag): boolean {
  const [path, op, value] = BOOK_LIST_FLAGS[flag] as BookListFlagWhere;
  const actual = path.split('.').reduce<any>((acc, key) => (acc == null ? acc : acc[key]), book);
  if (op === '==') return actual === value;
  if (op === '!=') return actual !== undefined && actual !== value;
  throw new Error(`Unsupported book list flag operator: ${op}`);
}

// Only these make Firestore order by the filtered field ahead of any explicit
// orderBy — `in` and `array-contains` do not.
const FIRESTORE_INEQUALITY_OPS = new Set<WhereFilterOp>(['<', '<=', '>', '>=', '!=', 'not-in']);

export interface BookListQuery {
  order: 'asc' | 'desc';
  owner?: string;
  limit: number;
  flags: BookListFlag[];
}

export interface BookListResult {
  books: AdminBookListItem[];
  total: number;
  isScanCapped: boolean;
}

function parseKeyValueToken(raw: string, separatorIndex: number): Partial<BookListQuery> {
  const key = raw.slice(0, separatorIndex).toLowerCase();
  // Keep the original case: wallets and ids are not lowercase.
  const value = raw.slice(separatorIndex + 1);
  if (!value) throw new Error(`Missing value for ${key}`);
  switch (key) {
    case 'owner':
      return { owner: value };
    case 'limit':
      if (!/^\d+$/.test(value) || Number(value) === 0) {
        throw new Error(`Invalid limit: ${value}`);
      }
      return { limit: Math.min(Number(value), BOOK_LIST_MAX_LIMIT) };
    default:
      throw new Error(`Unknown filter: ${raw}`);
  }
}

export function parseBookListQuery(params: string[] = []): BookListQuery {
  const query: BookListQuery = {
    order: 'desc',
    limit: BOOK_LIST_DEFAULT_LIMIT,
    flags: [],
  };
  params.forEach((param) => {
    const raw = param.trim();
    if (!raw) return;
    const token = raw.toLowerCase();
    if (token === 'asc' || token === 'desc') {
      query.order = token;
      return;
    }
    // Index against `raw`: lowercasing is not always length-preserving.
    const separatorIndex = raw.indexOf(':');
    if (separatorIndex > 0) {
      Object.assign(query, parseKeyValueToken(raw, separatorIndex));
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(BOOK_LIST_FLAGS, token)) {
      throw new Error(`Unknown filter: ${raw}`);
    }
    const flag = token as BookListFlag;
    if (!query.flags.includes(flag)) query.flags.push(flag);
  });
  return query;
}

export function describeBookListQuery(query: BookListQuery): string {
  const parts = [`chain ${BOOK_LIST_CHAIN}`];
  parts.push(...query.flags);
  if (query.owner) parts.push(`owner ${query.owner}`);
  parts.push(query.order === 'asc' ? 'oldest first' : 'newest first');
  return parts.join(', ');
}

function toBookListItem(doc: { id: string; data: () => unknown }): AdminBookListItem {
  const data = doc.data() as Partial<NFTBookListingInfo>;
  return { ...data, classId: data.classId || doc.id };
}

async function queryBooksForAdmin(query: BookListQuery): Promise<BookListResult> {
  const base = query.owner
    // Wallets are stored checksummed, so an exact match is the right comparison.
    ? likeNFTBookCollection.where('chain', '==', BOOK_LIST_CHAIN).where('ownerWallet', '==', query.owner)
    : likeNFTBookCollection.where('chain', '==', BOOK_LIST_CHAIN);
  const filtered = query.flags.reduce<Query>(
    (acc, flag) => acc.where(...(BOOK_LIST_FLAGS[flag] as BookListFlagWhere)),
    base,
  );

  if (query.flags.some((flag) => FIRESTORE_INEQUALITY_OPS.has(BOOK_LIST_FLAGS[flag][1]))) {
    // Firestore orders by an inequality's own field before any explicit orderBy,
    // so a server-side limit would take the wrong slice. Order the matches here.
    const snapshot = await filtered
      .limit(BOOK_LIST_INEQUALITY_MAX_SCAN)
      .select(...BOOK_LIST_FIELD_MASK)
      .get();
    const books = snapshot.docs.map(toBookListItem).sort((a, b) => (query.order === 'asc'
      ? getBookTimestampMillis(a) - getBookTimestampMillis(b)
      : getBookTimestampMillis(b) - getBookTimestampMillis(a)));
    return {
      books: books.slice(0, query.limit),
      total: books.length,
      isScanCapped: snapshot.size >= BOOK_LIST_INEQUALITY_MAX_SCAN,
    };
  }

  // Count off the *ordered* query: orderBy drops docs missing the field, so
  // counting before it would include listings the page can never reach.
  const ordered = filtered.orderBy('timestamp', query.order);
  const [snapshot, count] = await Promise.all([
    ordered.limit(query.limit).select(...BOOK_LIST_FIELD_MASK).get(),
    ordered.count().get(),
  ]);
  return {
    books: snapshot.docs.map(toBookListItem),
    total: count.data().count,
    isScanCapped: false,
  };
}

// Every filter combination needs its own composite index, and Firestore answers
// a missing one with FAILED_PRECONDITION plus a one-click creation link. Say
// that plainly rather than handing an admin a raw gRPC error.
export async function listBooksForAdmin(query: BookListQuery): Promise<BookListResult> {
  try {
    return await queryBooksForAdmin(query);
  } catch (err) {
    if (!isFailedPreconditionError(err)) throw err;
    throw Object.assign(
      new Error(`This filter combination needs a one-off Firestore index.\n${(err as Error).message}`),
      { cause: err },
    );
  }
}
