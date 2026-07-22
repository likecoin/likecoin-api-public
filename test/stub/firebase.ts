/* eslint-disable @typescript-eslint/no-unused-vars, no-use-before-define */
import cloneDeep from 'lodash.clonedeep';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import type { UserData } from '../../src/types/user';
import type {
  NFTBookListingInfo,
  NFTBookCMSTag,
  BookPurchaseCartData,
  NFTBookUserData,
  PlusGiftCartData,
} from '../../src/types/book';
import type { LikeNFTISCNData, FreeMintTxData } from '../../src/types/nft';
import type { TxData, ArweaveTxData } from '../../src/types/transaction';
import type {
  UserAuthData,
  SubscriptionUserData,
  SuperLikeData,
  IAPData,
  MissionData,
  PayoutData,
  ConfigData,
  OAuthClientInfo,
  LikeButtonUrlData,
  ISCNInfoData,
  ISCNMappingData,
} from '../../src/types/firestore';

// Stub a Firestore Timestamp-like object whose closure remembers the captured Date,
// so toDate() and toMillis() are consistent across re-reads.
function makeTimestampStub(d: Date) {
  return { toDate: () => d, toMillis: () => d.getTime() };
}

// Sentinel distinct from null,
// so the stub can distinguish a null write from a FieldValue.delete().
// Matches real Firestore: null is stored as null, only the delete sentinel removes the field.
export const FIELD_VALUE_DELETE = Symbol('__FIELD_VALUE_DELETE__');

// Mock firebase-admin types
const admin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => makeTimestampStub(new Date()),
      increment: (n: number) => n,
      arrayUnion: (...items: unknown[]) => items,
      arrayRemove: (...items: unknown[]) => items,
      delete: () => FIELD_VALUE_DELETE,
    },
    Timestamp: {
      now: () => makeTimestampStub(new Date()),
      fromDate: (d: Date) => makeTimestampStub(d),
      fromMillis: (ms: number) => makeTimestampStub(new Date(ms)),
    },
  },
};

export { admin };
export const { FieldValue, Timestamp } = admin.firestore;

interface StubData {
  id: string;
  collection?: Record<string, StubData[]>;
  [key: string]: unknown;
}

let userData: StubData[] = [];
let subscriptionData: StubData[] = [];
let txData: StubData[] = [];
let missionData: StubData[] = [];
let likerNftData: StubData[] = [];
// Not JSON-backed: seeded per-test. Kept as stable references (mutated in place on reset, see
// resetTestData) so `dbData` and their collections never lose the binding. `likeNftBookData`
// and `likeNftBookUserData` are in `dbData` so collectionGroup() reaches their subcollections
// (e.g. plusUsage, plusReadingPayouts).
const likeNftBookData: StubData[] = [];
const likeNftBookUserData: StubData[] = [];
const configData: StubData[] = [];

// Load test data
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  userData = require('../data/user.json').users || [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  subscriptionData = require('../data/subscription.json').subscriptions || [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  txData = require('../data/tx.json').tx || [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  missionData = require('../data/mission.json').missions || [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  likerNftData = require('../data/likernft.json').likernft || [];
} catch (e) {
  // Test data files may not exist, that's okay
}

// Reset function to restore initial data
export function resetTestData() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    userData = require('../data/user.json').users || [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    subscriptionData = require('../data/subscription.json').subscriptions || [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    txData = require('../data/tx.json').tx || [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    missionData = require('../data/mission.json').missions || [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    likerNftData = require('../data/likernft.json').likernft || [];
  } catch (e) {
    // Ignore errors
  }
  // Clear per-test seeded (non-JSON) collections in place — keep the array references intact.
  likeNftBookData.length = 0;
  likeNftBookUserData.length = 0;
  configData.length = 0;
}

function docData(obj: StubData): any {
  const res: any = {
    ...obj,
  };
  delete res.id;
  return res;
}

function docUpdate(
  data: StubData[],
  id: string,
  obj: StubData,
  updateData: Partial<StubData>,
): Promise<void> {
  if (Object.values(updateData).some((v) => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const index = data.findIndex((d) => d.id === id);
  if (index === -1) throw new Error('not found');
  // Apply Firestore-style dot-paths against nested maps.
  // FIELD_VALUE_DELETE (from FieldValue.delete()) removes the field;
  // plain `null` is stored as null, matching real Firestore semantics.
  Object.entries(updateData).forEach(([key, value]) => {
    if (key.includes('.')) {
      const parts = key.split('.');
      const leaf = parts.pop() as string;
      let cursor: any = obj;
      parts.forEach((p) => {
        if (cursor[p] == null) {
          cursor[p] = {};
        } else if (typeof cursor[p] !== 'object') {
          throw new Error(`Cannot use dot-path update: intermediate field "${p}" is not a map`);
        }
        cursor = cursor[p];
      });
      if (value === FIELD_VALUE_DELETE) {
        delete cursor[leaf];
      } else {
        cursor[leaf] = value;
      }
    } else if (value === FIELD_VALUE_DELETE) {
      // eslint-disable-next-line no-param-reassign
      delete (obj as any)[key];
    } else {
      // eslint-disable-next-line no-param-reassign
      (obj as any)[key] = value;
    }
  });
  return Promise.resolve();
}

function docDelete(data: StubData[], { id }: { id: string }): void {
  const index = data.findIndex((obj) => obj.id === id);
  data.splice(index, 1);
}

function docSet(
  data: StubData[],
  id: string,
  setData: Partial<StubData>,
  config: any = {},
): Promise<void> {
  if (Object.values(setData).some((v) => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const obj = data.find((d) => d.id === id);
  if (obj && config && config.merge) {
    return docUpdate(data, id, obj, setData);
  }
  const pushData: StubData = {
    ...setData,
    id,
  } as StubData;
  data.push(pushData);
  return Promise.resolve();
}

function querySnapshotDocs(inputData: StubData[], originalData: StubData[]): any[] {
  const data = inputData;
  return data.map((d) => {
    const docObj = {
      id: d.id,
      ref: {
        set: async (setData: Partial<StubData>, config = {}) => (
          docSet(originalData, d.id, setData, config)
        ),
        create: async (setData: Partial<StubData>) => {
          const existing = originalData.find((item) => item.id === d.id);
          if (existing) {
            const error = new Error('Document already exists');
            (error as any).code = 6;
            throw error;
          }
          return docSet(originalData, d.id, setData);
        },
        update: async (updateData: Partial<StubData>) => (
          docUpdate(originalData, d.id, d, updateData)
        ),
        delete: async () => docDelete(originalData, { id: d.id }),
        collection: (id: string) => createCollection(d.collection?.[id] || []),
      },
      data: () => docData(d),
      exists: true,
    };
    return docObj;
  });
}

// Resolve a (possibly dotted) field path against a doc, mirroring Firestore's nested-map traversal.
// Returns undefined when any segment is missing.
function resolveField(d: StubData, field: string): unknown {
  if (!field.includes('.')) return d[field];
  return field.split('.').reduce<any>((acc, f) => (acc == null ? acc : acc[f]), d);
}

// Evaluate one where() clause against a doc. Range ops exclude docs missing the field,
// matching Firestore (a missing field never satisfies an inequality / equality / membership).
function matchesWhereClause(d: StubData, field: string, op: string, value: any): boolean {
  const v = resolveField(d, field);
  switch (op) {
    case '==': return v === value;
    case '!=': return v !== undefined && v !== value;
    case '>': return v !== undefined && (v as any) > value;
    case '>=': return v !== undefined && (v as any) >= value;
    case '<': return v !== undefined && (v as any) < value;
    case '<=': return v !== undefined && (v as any) <= value;
    case 'in': return v !== undefined && (value as any[]).includes(v);
    case 'array-contains': return Array.isArray(v) && (v as any[]).includes(value);
    default: throw new Error(`stub firestore: unsupported where operator '${op}'`);
  }
}

function collectionWhere(data: StubData[], field = '', op = '', value: any = ''): any {
  // Empty op (orderBy/startAt/limit call this with no clause) means no filtering.
  const whereData = op ? data.filter((d) => matchesWhereClause(d, field, op, value)) : data;
  const docs = querySnapshotDocs(whereData, data);
  const queryObj = {
    where: (sField: string, sOp: string, sValue: any) => (
      collectionWhere(whereData, sField, sOp, sValue)
    ),
    orderBy: (sField: string, order: 'asc' | 'desc' = 'asc') => {
      if (data.length > 0 && sField in data[0] && (order === 'asc' || order === 'desc')) {
        return queryObj;
      }
      return queryObj;
    },
    startAt: () => queryObj,
    startAfter: () => queryObj,
    endBefore: () => queryObj,
    limit: () => queryObj,
    offset: () => queryObj,
    get: () => Promise.resolve({
      size: docs.length,
      docs,
      empty: docs.length === 0,
      forEach: (f: (doc: any) => void) => docs.forEach(f),
    }),
  };
  return queryObj;
}

function collectionDoc(data: StubData[], id: string): any {
  let docObj: any;
  const obj = data.find((d) => d.id === id);
  if (obj) {
    const cloneObj = cloneDeep(obj);
    docObj = {
      exists: true,
      id: obj.id,
      data: () => docData(cloneObj),
    };
    if (!obj.collection) {
      obj.collection = {};
    }
  } else {
    docObj = {
      exists: false,
      id,
      data: () => undefined,
    };
  }

  return {
    get: async function get() {
      return Promise.resolve({
        ...docObj,
        ref: this,
      });
    },
    set: async (setData: Partial<StubData>, config = {}) => docSet(data, id, setData, config),
    create: async (setData: Partial<StubData>) => {
      const existing = data.find((item) => item.id === id);
      if (existing) {
        const error = new Error('Document already exists');
        (error as any).code = 6;
        throw error;
      }
      return docSet(data, id, setData);
    },
    update: async (updateData: Partial<StubData>) => {
      if (obj) {
        return docUpdate(data, id, obj, updateData);
      }
      const error = new Error('Document not found');
      (error as any).code = 5;
      throw error;
    },
    delete: async () => {
      if (obj) {
        return docDelete(data, obj);
      }
      throw new Error('Doc not exists for deletion.');
    },
    collection: (collectionId: string) => {
      if (obj) {
        if (!obj.collection) {
          obj.collection = {};
        }
        if (!obj.collection[collectionId]) {
          obj.collection[collectionId] = [];
        }
        return createCollection(obj.collection[collectionId]);
      }
      return createCollection([]);
    },
  };
}

function createCollection(data: StubData[]): any {
  return {
    where: (field: string, op: string, value: any) => collectionWhere(data, field, op, value),
    doc: (id: string) => collectionDoc(data, id),
    get: () => {
      const docs = querySnapshotDocs(data, data);
      return Promise.resolve({
        size: docs.length,
        docs,
        empty: docs.length === 0,
        forEach: (f: (doc: any) => void) => docs.forEach(f),
      });
    },
    orderBy: (sField: string, order: 'asc' | 'desc' = 'asc') => collectionWhere(data),
    startAt: () => collectionWhere(data),
    startAfter: () => collectionWhere(data),
    limit: () => collectionWhere(data),
  };
}

const dbData: StubData[][] = [
  userData,
  subscriptionData,
  txData,
  missionData,
  likerNftData,
  likeNftBookData,
  likeNftBookUserData,
];

export const userCollection = createCollection(userData) as
  CollectionReference<UserData>;
export const userAuthCollection = createCollection([]) as
  CollectionReference<UserAuthData>;
export const subscriptionUserCollection = createCollection(
  subscriptionData,
) as CollectionReference<SubscriptionUserData>;
export const txCollection = createCollection(txData) as
  CollectionReference<TxData>;
export const iapCollection = createCollection([]) as
  CollectionReference<IAPData>;
export const missionCollection = createCollection(missionData) as
  CollectionReference<MissionData>;
export const payoutCollection = createCollection([]) as
  CollectionReference<PayoutData>;
export const configCollection = createCollection(configData) as
  CollectionReference<ConfigData>;
export const oAuthClientCollection = createCollection([]) as
  CollectionReference<OAuthClientInfo>;
export const couponCollection = createCollection([]) as CollectionReference<any>;
export const likeNFTCollection = createCollection(likerNftData) as
  CollectionReference<LikeNFTISCNData>;
export const likeNFTSubscriptionUserCollection = createCollection([]) as
  CollectionReference<SubscriptionUserData>;
export const likeNFTFreeMintTxCollection = createCollection([]) as
  CollectionReference<FreeMintTxData>;
export const likeNFTBookCartCollection = createCollection([]) as
  CollectionReference<BookPurchaseCartData>;
export const likeNFTBookCollection = createCollection(likeNftBookData) as
  CollectionReference<NFTBookListingInfo>;
export const likeNFTBookCMSTagCollection = createCollection([]) as
  CollectionReference<NFTBookCMSTag>;
export const likeNFTBookUserCollection = createCollection(likeNftBookUserData) as
  CollectionReference<NFTBookUserData>;
export const likeButtonUrlCollection = createCollection([]) as
  CollectionReference<LikeButtonUrlData>;
export const iscnInfoCollection = createCollection([]) as
  CollectionReference<ISCNInfoData>;
export const iscnArweaveTxCollection = createCollection([]) as
  CollectionReference<ArweaveTxData>;
export const iscnMappingCollection = createCollection([]) as
  CollectionReference<ISCNMappingData>;
export const superLikeUserCollection = createCollection([]) as
  CollectionReference<SuperLikeData>;
export const likePlusGiftCartCollection = createCollection([]) as
  CollectionReference<PlusGiftCartData>;

function runTransaction(updateFunc: (transaction: any) => Promise<any>): Promise<any> {
  return updateFunc({
    get: (ref: any) => ref.get(),
    create: (ref: any, data: any) => ref.create(data),
    // Real Transaction.set writes over an existing doc (and honours merge);
    // only create() rejects one.
    set: (ref: any, data: any, config = {}) => ref.set(data, config),
    update: (ref: any, data: any) => ref.update(data),
    delete: (ref: any) => ref.delete(),
  });
}

function createDb(): Firestore {
  return {
    runTransaction: (updateFunc: (transaction: any) => Promise<any>) => runTransaction(updateFunc),
    batch: () => {
      // Real Firestore batches are atomic: if any op fails at commit, none land.
      // Two-phase commit: run every op's precheck against pre-batch state first,
      // then apply mutations only if all prechecks pass.
      type BatchOp = {
        precheck: () => Promise<void>;
        apply: () => Promise<unknown>;
      };
      const ops: BatchOp[] = [];
      return {
        get: (ref: any) => ref.get(),
        create: (ref: any, data: any) => {
          ops.push({
            precheck: async () => {
              const snap = await ref.get();
              if (snap.exists) {
                const error = new Error('Document already exists');
                (error as any).code = 6;
                throw error;
              }
            },
            apply: () => ref.create(data),
          });
        },
        set: (ref: any, data: any, config = {}) => {
          // batch.set() always succeeds (overwrites or merges) — no precheck needed.
          ops.push({
            precheck: async () => {},
            apply: () => ref.set(data, config),
          });
        },
        update: (ref: any, data: any) => {
          ops.push({
            precheck: async () => {
              const snap = await ref.get();
              if (!snap.exists) {
                const error = new Error('Document not found');
                (error as any).code = 5;
                throw error;
              }
            },
            apply: () => ref.update(data),
          });
        },
        delete: (ref: any) => {
          // Real Firestore allows deleting a missing doc, but this stub's ref.delete() throws;
          // swallow the not-found case to match real behavior.
          ops.push({
            precheck: async () => {},
            apply: async () => {
              try {
                await ref.delete();
              } catch (e: any) {
                if (e?.message === 'Doc not exists for deletion.') return;
                throw e;
              }
            },
          });
        },
        commit: async () => {
          // eslint-disable-next-line no-restricted-syntax
          for (const op of ops) {
            // eslint-disable-next-line no-await-in-loop
            await op.precheck();
          }
          // eslint-disable-next-line no-restricted-syntax
          for (const op of ops) {
            // eslint-disable-next-line no-await-in-loop
            await op.apply();
          }
        },
      };
    },
    recursiveDelete: async (ref: any) => {
      // Simple recursive delete implementation
      const snapshot = await ref.get();
      if (snapshot.exists) {
        await ref.delete();
      }
      return Promise.resolve();
    },
    collectionGroup: (group: string) => {
      // Flatten every `group` subcollection across roots, tagging each doc with its owning
      // doc id so `doc.ref.parent.parent.id` resolves (settlement reads the book classId
      // from a plusUsage doc this way). Real Firestore exposes the full ref chain; the stub
      // only carries the one hop callers actually use.
      const entries: Array<{ d: StubData; parentId: string }> = [];
      const collect = (owner: StubData) => {
        if (!owner.collection) return;
        if (owner.collection[group]) {
          owner.collection[group].forEach((d) => entries.push({ d, parentId: owner.id }));
        }
        Object.values(owner.collection).forEach((c) => c.forEach(collect));
      };
      dbData.forEach((root) => root.forEach(collect));
      // Build a chainable query that keeps the parentId tagging through where() so a filtered
      // collection-group snapshot still resolves doc.ref.parent.parent.id (real Firestore does).
      const makeQuery = (rows: Array<{ d: StubData; parentId: string }>): any => {
        const docs = rows.map(({ d, parentId }) => ({
          id: d.id,
          data: () => docData(d),
          exists: true,
          ref: { parent: { parent: { id: parentId } } },
        }));
        return {
          get: () => Promise.resolve({
            size: docs.length,
            docs,
            empty: docs.length === 0,
            forEach: (f: (doc: any) => void) => docs.forEach(f),
          }),
          where: (field: string, op: string, value: any) => (
            makeQuery(rows.filter(({ d }) => matchesWhereClause(d, field, op, value)))
          ),
        };
      };
      return makeQuery(entries);
    },
  } as unknown as Firestore;
}

export const db = createDb();
export const bucket = {} as ReturnType<Storage['bucket']>;
export const adminApp = {} as any;
