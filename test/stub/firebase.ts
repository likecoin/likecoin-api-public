/* eslint-disable @typescript-eslint/no-unused-vars, no-use-before-define */
import cloneDeep from 'lodash.clonedeep';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import type { UserData } from '../../src/types/user';
import type {
  NFTBookListingInfo, BookPurchaseCartData, NFTBookUserData, PlusGiftCartData,
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

// Mock firebase-admin types
const admin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => ({ toDate: () => new Date() }),
      increment: (n: number) => n,
      arrayUnion: (...items: unknown[]) => items,
      arrayRemove: (...items: unknown[]) => items,
      delete: () => null,
    },
    Timestamp: {
      now: () => ({ toDate: () => new Date() }),
      fromDate: (d: Date) => ({ toDate: () => d }),
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
  // eslint-disable-next-line no-param-reassign
  Object.assign(obj, updateData);
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

function collectionWhere(data: StubData[], field = '', op = '', value: any = ''): any {
  let whereData = data;
  if (op === '==') {
    if (field.includes('.')) {
      const fields = field.split('.');
      whereData = data.filter((d) => fields.reduce((acc: any, f) => {
        if (!acc) return acc;
        return acc[f as keyof typeof acc];
      }, d));
    } else {
      whereData = data.filter((d) => d[field] === value);
    }
  } else if (op === 'array-contains') {
    whereData = data.filter((d) => Array.isArray(d[field]) && d[field].includes(value));
  } else if (op === '>=') {
    whereData = data.filter((d) => (d[field] as any) >= value);
  } else if (op === '<=') {
    whereData = data.filter((d) => (d[field] as any) <= value);
  } else if (op === '!=') {
    whereData = data.filter((d) => d[field] !== value);
  } else if (op === 'in') {
    whereData = data.filter((d) => (value as any[]).includes(d[field]));
  }
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
export const configCollection = createCollection([]) as
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
export const likeNFTBookCollection = createCollection([]) as
  CollectionReference<NFTBookListingInfo>;
export const likeNFTBookUserCollection = createCollection([]) as
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
    set: (ref: any, data: any, config = {}) => ref.create(data, config),
    update: (ref: any, data: any) => ref.update(data),
    delete: (ref: any) => ref.delete(),
  });
}

function createDb(): Firestore {
  return {
    runTransaction: (updateFunc: (transaction: any) => Promise<any>) => runTransaction(updateFunc),
    batch: () => ({
      get: (ref: any) => ref.get(),
      create: (ref: any, data: any) => ref.create(data),
      set: (ref: any, data: any, config = {}) => ref.create(data, config),
      update: (ref: any, data: any) => ref.update(data),
      delete: (ref: any) => ref.delete(),
      commit: async () => Promise.resolve(),
    }),
    recursiveDelete: async (ref: any) => {
      // Simple recursive delete implementation
      const snapshot = await ref.get();
      if (snapshot.exists) {
        await ref.delete();
      }
      return Promise.resolve();
    },
    collectionGroup: (group: string) => {
      let data: StubData[] = [];
      dbData.forEach((root) => {
        root.forEach((d) => {
          if (d.collection) {
            if (d.collection[group]) data = data.concat(d.collection[group]);
            Object.values(d.collection).forEach((c: any) => {
              c.forEach((cd: StubData) => {
                if (cd.collection && cd.collection[group]) data = data.concat(cd.collection[group]);
              });
            });
          }
        });
      });
      return collectionWhere(data);
    },
  } as unknown as Firestore;
}

export const db = createDb();
export const bucket = {} as ReturnType<Storage['bucket']>;
export const adminApp = {} as any;
