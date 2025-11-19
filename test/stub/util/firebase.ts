/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint import/no-unresolved: "off" */
/* eslint import/extensions: "off" */
import * as admin from 'firebase-admin';
import cloneDeep from 'lodash.clonedeep'; // eslint-disable-line import/no-extraneous-dependencies
// These imports will work when this file is copied to src/util/firebase.ts during tests
// The relative path is correct for the destination location
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
import type { UserData } from '../types/user';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
import type { NFTBookListingInfo, BookPurchaseCartData, NFTBookUserData } from '../types/book';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
import type { LikeNFTISCNData, FreeMintTxData } from '../types/nft';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
import type { TxData, ArweaveTxData } from '../types/transaction';
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
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
} from '../types/firestore';
import {
  PlusGiftCartData,
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Path is valid when copied to src/util/
} from '../types/book';

export { admin };
export const { FieldValue, Timestamp } = admin.firestore;

console.log('Using stub (firebase.js)'); /* eslint no-console: "off" */

interface StubData {
  id: string;
  collection?: Record<string, StubData[]>;
  [key: string]: any;
}

const userData: StubData[] = require('../../test/data/user.json').users;
const subscriptionData: StubData[] = require('../../test/data/subscription.json').subscriptions;
const txData: StubData[] = require('../../test/data/tx.json').tx;
const missionData: StubData[] = require('../../test/data/mission.json').missions;
const likerNftData: StubData[] = require('../../test/data/likernft.json').likernft;

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
  data[id] = Object.assign(obj, updateData);
  return global.Promise.resolve();
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
  return global.Promise.resolve();
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
        create: async (setData: Partial<StubData>) => (
          docSet(originalData, d.id, setData)
        ),
        update: async (updateData: Partial<StubData>) => (
          docUpdate(originalData, d.id, d, updateData)
        ),
        delete: async () => docDelete(originalData, { id: d.id }),
        // eslint-disable-next-line no-use-before-define
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
        return acc[f];
      }, d));
    } else {
      whereData = data.filter((d) => d[field] === value);
    }
  } else if (op === 'array-contains') {
    whereData = data.filter((d) => Array.isArray(d[field]) && d[field].includes(value));
  } else if (op === '>=') {
    whereData = data.filter((d) => d[field] >= value);
  } else if (op === '<=') {
    whereData = data.filter((d) => d[field] <= value);
  } else if (op === '!=') {
    whereData = data.filter((d) => d[field] !== value);
  } else if (op) {
    console.error(`operator ${op} is not supported`);
  }
  const docs = querySnapshotDocs(whereData, data);
  const queryObj = {
    where: (sField: string, sOp: string, sValue: any) => (
      collectionWhere(whereData, sField, sOp, sValue)
    ),
    orderBy: (sField: string, order: 'asc' | 'desc' = 'asc') => {
      if (sField in data[0] && (order === 'asc' || order === 'desc')) {
        return queryObj;
      }
      throw new Error('orderBy is incorrect.');
    },
    startAt: (_: number) => queryObj,
    startAfter: (_: number) => queryObj,
    endBefore: (_: number) => queryObj,
    limit: (limit: number) => {
      if (Number.isInteger(limit)) {
        return queryObj;
      }
      throw new Error('limit should be integer.');
    },
    get: () => global.Promise.resolve({
      size: docs.length,
      docs,
      forEach: (f: (doc: any) => void) => docs.forEach(f),
    }),
  };
  return queryObj;
}

/* eslint-disable no-use-before-define */
function collectionDoc(data: StubData[], id: string): any {
  let docObj: any;
  const obj = data.find((d) => d.id === id);
  if (obj) {
    // deep clone data object
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
      data: () => undefined,
    };
  }

  return {
    get: async function get() {
      return global.Promise.resolve({
        ...docObj,
        ref: this,
      });
    },
    set: async (setData: Partial<StubData>, config = {}) => docSet(data, id, setData, config),
    create: async (setData: Partial<StubData>) => docSet(data, id, setData),
    update: async (updateData: Partial<StubData>) => {
      if (obj) {
        return docUpdate(data, id, obj, updateData);
      }
      return global.Promise.resolve();
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
/* eslint-enable no-use-before-define */

function createCollection(data: StubData[]): any {
  return {
    where: (field: string, op: string, value: any) => collectionWhere(data, field, op, value),
    doc: (id: string) => collectionDoc(data, id),
    get: () => {
      const docs = querySnapshotDocs(data, data);
      return global.Promise.resolve({
        size: docs.length,
        docs,
        forEach: (f: (doc: any) => void) => docs.forEach(f),
      });
    },
    startAt: (_: number) => collectionWhere(data),
    startAfter: (_: number) => collectionWhere(data),
    endBefore: (_: number) => collectionWhere(data),
    limit: (_: number) => collectionWhere(data),
    orderBy: (sField: string, order: 'asc' | 'desc' = 'asc') => collectionWhere(data),
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
  admin.firestore.CollectionReference<UserData>;
export const userAuthCollection = createCollection([]) as
  admin.firestore.CollectionReference<UserAuthData>;
export const subscriptionUserCollection = createCollection(
  subscriptionData,
) as admin.firestore.CollectionReference<SubscriptionUserData>;
export const txCollection = createCollection(txData) as
  admin.firestore.CollectionReference<TxData>;
export const iapCollection = createCollection([]) as
  admin.firestore.CollectionReference<IAPData>;
export const missionCollection = createCollection(missionData) as
  admin.firestore.CollectionReference<MissionData>;
export const payoutCollection = createCollection([]) as
  admin.firestore.CollectionReference<PayoutData>;
export const configCollection = createCollection([]) as
  admin.firestore.CollectionReference<ConfigData>;
export const oAuthClientCollection = createCollection([]) as
  admin.firestore.CollectionReference<OAuthClientInfo>;
export const likeNFTCollection = createCollection(likerNftData) as
  admin.firestore.CollectionReference<LikeNFTISCNData>;
export const likeNFTSubscriptionUserCollection = createCollection([]) as
  admin.firestore.CollectionReference<SubscriptionUserData>;
export const likeNFTFreeMintTxCollection = createCollection([]) as
  admin.firestore.CollectionReference<FreeMintTxData>;
export const likeNFTBookCartCollection = createCollection([]) as
  admin.firestore.CollectionReference<BookPurchaseCartData>;
export const likeNFTBookCollection = createCollection([]) as
  admin.firestore.CollectionReference<NFTBookListingInfo>;
export const likeNFTBookUserCollection = createCollection([]) as
  admin.firestore.CollectionReference<NFTBookUserData>;
export const likeButtonUrlCollection = createCollection([]) as
  admin.firestore.CollectionReference<LikeButtonUrlData>;
export const iscnInfoCollection = createCollection([]) as
  admin.firestore.CollectionReference<ISCNInfoData>;
export const iscnArweaveTxCollection = createCollection([]) as
  admin.firestore.CollectionReference<ArweaveTxData>;
export const iscnMappingCollection = createCollection([]) as
  admin.firestore.CollectionReference<ISCNMappingData>;
export const superLikeUserCollection = createCollection([]) as
  admin.firestore.CollectionReference<SuperLikeData>;
export const likePlusGiftCartCollection = createCollection([]) as
  admin.firestore.CollectionReference<PlusGiftCartData>;

function runTransaction(updateFunc: (transaction: any) => Promise<any>): Promise<any> {
  return updateFunc({
    get: (ref: any) => ref.get(),
    create: (ref: any, data: any) => ref.create(data),
    set: (ref: any, data: any, config = {}) => ref.create(data, config),
    update: (ref: any, data: any) => ref.update(data),
  });
}

async function initDb(): Promise<boolean> {
  return true;
}

function createDb(): admin.firestore.Firestore {
  return {
    runTransaction: (updateFunc: (transaction: any) => Promise<any>) => runTransaction(updateFunc),
    batch: () => ({
      get: (ref: any) => ref.get(),
      create: (ref: any, data: any) => ref.create(data),
      set: (ref: any, data: any, config = {}) => ref.create(data, config),
      update: (ref: any, data: any) => ref.update(data),
      delete: (ref: any) => ref.delete(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      commit: async () => {},
    }),
    recursiveDelete: (ref: any) => ref.delete(),
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
  } as unknown as admin.firestore.Firestore;
}

initDb();
export const db = createDb();
export const bucket = {} as ReturnType<admin.storage.Storage['bucket']>;
