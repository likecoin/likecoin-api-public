/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint import/no-unresolved: "off" */
/* eslint import/extensions: "off" */
import * as admin from 'firebase-admin';
import cloneDeep from 'lodash.clonedeep'; // eslint-disable-line import/no-extraneous-dependencies

export { admin };
export const { FieldValue, Timestamp } = admin.firestore;

console.log('Using stub (firebase.js)'); /* eslint no-console: "off" */

const userData = require('../../test/data/user.json').users;
const subscriptionData = require('../../test/data/subscription.json').subscriptions;
const txData = require('../../test/data/tx.json').tx;
const missionData = require('../../test/data/mission.json').missions;
const likerNftData = require('../../test/data/likernft.json').likernft;

function docData(obj) {
  const res = {
    ...obj,
  };
  delete res.id;
  return res;
}

function docUpdate(data, id, obj, updateData) {
  if (Object.values(updateData).some((v) => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const index = data.findIndex((d) => d.id === id);
  if (index === -1) throw new Error('not found');
  // eslint-disable-next-line no-param-reassign
  data[id] = Object.assign(obj, updateData);
  return global.Promise.resolve();
}

function docDelete(data, { id }) {
  const index = data.findIndex((obj) => obj.id === id);
  data.splice(index, 1);
}

function docSet(data, id, setData, config: any = {}) {
  if (Object.values(setData).some((v) => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const obj = data.find((d) => d.id === id);
  if (obj && config && config.merge) {
    return docUpdate(data, id, obj, setData);
  }
  const pushData = {
    ...setData,
    id,
  };
  data.push(pushData);
  return global.Promise.resolve();
}

function querySnapshotDocs(inputData, originalData) {
  const data = inputData;
  return data.map((d) => {
    const docObj = {
      id: d.id,
      ref: {
        set: async (setData, config = {}) => docSet(originalData, d.id, setData, config),
        create: async (setData) => docSet(originalData, d.id, setData),
        update: async (updateData) => docUpdate(originalData, d.id, d, updateData),
        delete: async () => docDelete(originalData, { id: d.id }),
        // eslint-disable-next-line no-use-before-define
        collection: (id) => createCollection(d.collection[id]),
      },
      data: () => docData(d),
      exists: true,
    };
    return docObj;
  });
}

function collectionWhere(data, field = '', op = '', value = '') {
  let whereData = data;
  if (op === '==') {
    if (field.includes('.')) {
      const fields = field.split('.');
      whereData = data.filter((d) => fields.reduce((acc, f) => {
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
    where: (sField, sOp, sValue) => collectionWhere(whereData, sField, sOp, sValue),
    orderBy: (sField, order = 'asc') => {
      if (sField in data[0] && (order === 'asc' || order === 'desc')) {
        return queryObj;
      }
      throw new Error('orderBy is incorrect.');
    },
    startAt: (_: number) => queryObj,
    startAfter: (_: number) => queryObj,
    endBefore: (_: number) => queryObj,
    limit: (limit) => {
      if (Number.isInteger(limit)) {
        return queryObj;
      }
      throw new Error('limit should be integer.');
    },
    get: () => global.Promise.resolve({
      size: docs.length,
      docs,
      forEach: (f) => docs.forEach(f),
    }),
  };
  return queryObj;
}

function collectionDoc(data, id) {
  let docObj;
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
    set: async (setData, config = {}) => docSet(data, id, setData, config),
    create: async (setData) => docSet(data, id, setData),
    update: async (updateData) => {
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
    collection: (collectionId) => {
      if (!obj.collection[collectionId]) {
        obj.collection[collectionId] = [];
      }
      /* eslint-disable no-use-before-define */
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return createCollection(obj.collection[collectionId]);
      /* eslint-enable no-use-before-define */
    },
  };
}

function createCollection(data) {
  return {
    where: (field, op, value) => collectionWhere(data, field, op, value),
    doc: (id) => collectionDoc(data, id),
    get: () => {
      const docs = querySnapshotDocs(data, data);
      return global.Promise.resolve({
        size: docs.length,
        docs,
        forEach: (f) => docs.forEach(f),
      });
    },
    startAt: (_: number) => collectionWhere(data),
    startAfter: (_: number) => collectionWhere(data),
    endBefore: (_: number) => collectionWhere(data),
    limit: (_: number) => collectionWhere(data),
    orderBy: (sField, order = 'asc') => collectionWhere(data),
  };
}

const dbData = [
  userData,
  subscriptionData,
  txData,
  missionData,
  likerNftData,
];
export const userCollection = createCollection(userData);
export const userAuthCollection = createCollection([]);
export const subscriptionUserCollection = createCollection(subscriptionData);
export const civicUserMetadataCollection = createCollection([]);
export const txCollection = createCollection(txData);
export const iapCollection = createCollection([]);
export const missionCollection = createCollection(missionData);
export const payoutCollection = createCollection([]);
export const configCollection = createCollection([]);
export const oAuthClientCollection = createCollection([]);
export const likeNFTCollection = createCollection(likerNftData);
export const likeNFTFiatCollection = createCollection([]);
export const likeNFTSubscriptionUserCollection = createCollection([]);
export const likeNFTSubscriptionTxCollection = createCollection([]);
export const likeNFTFreeMintTxCollection = createCollection([]);
export const likeNFTBookCartCollection = createCollection([]);
export const likeNFTBookCollection = createCollection([]);
export const likeNFTBookUserCollection = createCollection([]);
export const likeNFTCollectionCollection = createCollection([]);
export const likeButtonUrlCollection = createCollection([]);
export const iscnInfoCollection = createCollection([]);
export const iscnMappingCollection = createCollection([]);
export const superLikeTransferCollection = createCollection([]);
export const superLikeUserCollection = createCollection([]);
export const exchangeHubCollection = createCollection([]);

function runTransaction(updateFunc) {
  return updateFunc({
    get: (ref) => ref.get(),
    create: (ref, data) => ref.create(data),
    set: (ref, data, config = {}) => ref.create(data, config),
    update: (ref, data) => ref.update(data),
  });
}

async function initDb() {
  return true;
}

function createDb() {
  return {
    runTransaction: (updateFunc) => runTransaction(updateFunc),
    batch: () => ({
      get: (ref) => ref.get(),
      create: (ref, data) => ref.create(data),
      set: (ref, data, config = {}) => ref.create(data, config),
      update: (ref, data) => ref.update(data),
      delete: (ref) => ref.delete(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      commit: async () => {},
    }),
    recursiveDelete: (ref) => ref.delete(),
    collectionGroup: (group) => {
      let data = [];
      dbData.forEach((root) => {
        root.forEach((d) => {
          if (d.collection) {
            if (d.collection[group]) data = data.concat(d.collection[group]);
            Object.values(d.collection).forEach((c: any) => {
              c.forEach((cd) => {
                if (cd.collection && cd.collection[group]) data = data.concat(cd.collection[group]);
              });
            });
          }
        });
      });
      return collectionWhere(data);
    },
  };
}

initDb();
export const db = createDb();
export const bucket = {};
