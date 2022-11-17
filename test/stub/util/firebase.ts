/* eslint import/no-unresolved: "off" */
/* eslint import/extensions: "off" */
import * as admin from 'firebase-admin';
import cloneDeep from 'lodash.clonedeep'; // eslint-disable-line import/no-extraneous-dependencies

export { admin };
export const { FieldValue } = admin.firestore;

console.log('Using stub (firebase.js)'); /* eslint no-console: "off" */

const userData = require('../../test/data/user.json').users;
const configData = require('../../test/data/config.json').config;
const userAuthData = require('../../test/data/user-auth.json').usersAuth;
const userSubData = require('../../test/data/subscription-user.json').subscriptionUsers;
const userCivicData = require('../../test/data/user-civic-metadata.json').userCivicMetadata;

function docData(obj) {
  const res = {
    ...obj,
  };
  delete res.id;
  return res;
}

function docUpdate(obj, updateData) {
  if (Object.values(updateData).some(v => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  Object.assign(obj, updateData);
  return global.Promise.resolve();
}

function docDelete(data, { id }) {
  const index = data.findIndex(obj => obj.id === id);
  data.splice(index, 1);
}

function docSet(data, id, setData, config: any = {}) {
  if (Object.values(setData).some(v => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const obj = data.find(d => d.id === id);
  if (obj && config && config.merge) {
    return docUpdate(obj, setData);
  }
  const pushData = {
    ...setData,
    id,
  };
  data.push(pushData);
  return global.Promise.resolve();
}

function querySnapshotDocs(data) {
  return data.map((d) => {
    const docObj = {
      id: d.id,
      ref: {
        set: (setData, config) => docSet(data, d.id, setData, config),
        create: setData => docSet(data, d.id, setData),
        update: updateData => docUpdate(d, updateData),
      },
      data: () => docData(d),
    };
    return docObj;
  });
}

function collectionWhere(data, field = '', op = '', value = '') {
  let whereData = data;
  if (field && value && op === '==') {
    whereData = data.filter(d => d[field] === value);
  }
  const docs = querySnapshotDocs(whereData);
  const queryObj = {
    where: (sField, sOp, sValue) => collectionWhere(whereData, sField, sOp, sValue),
    orderBy: (sField, order = 'asc') => {
      if (sField in data[0] && (order === 'asc' || order === 'desc')) {
        return queryObj;
      }
      throw new Error('orderBy is incorrect.');
    },
    startAt: () => queryObj,
    startAfter: (_: number) => queryObj,
    endBefore: (_: number) => queryObj,
    limit: (limit) => {
      if (Number.isInteger(limit)) {
        return queryObj;
      }
      throw new Error('limit should be integer.');
    },
    get: () => global.Promise.resolve({
      docs,
      forEach: f => docs.forEach(f),
    }),
  };
  return queryObj;
}

function collectionDoc(data, id) {
  let docObj;
  const obj = data.find(d => d.id === id);
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
    get: function get() {
      return global.Promise.resolve({
        ...docObj,
        ref: this,
      });
    },
    set: (setData, config) => docSet(data, id, setData, config),
    create: setData => docSet(data, id, setData),
    update: (updateData) => {
      if (obj) {
        return docUpdate(obj, updateData);
      }
      return global.Promise.resolve();
    },
    delete: () => {
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
    doc: id => collectionDoc(data, id),
    get: () => {
      const docs = querySnapshotDocs(data);
      return global.Promise.resolve({
        docs,
        forEach: f => docs.forEach(f),
      });
    },
    orderBy: () => collectionWhere(data),
  };
}

export const userCollection = createCollection(userData);
export const userAuthCollection = createCollection(userAuthData);
export const subscriptionUserCollection = createCollection(userSubData);
export const civicUserMetadataCollection = createCollection(userCivicData);
export const txCollection = createCollection([]);
export const iapCollection = createCollection([]);
export const missionCollection = createCollection([]);
export const payoutCollection = createCollection([]);
export const configCollection = createCollection(configData);
export const oAuthClientCollection = createCollection([]);
export const likeButtonUrlCollection = createCollection([]);
export const iscnInfoCollection = createCollection([]);
export const iscnMappingCollection = createCollection([]);
export const superLikeTransferCollection = createCollection([]);
export const superLikeUserCollection = createCollection([]);
export const exchangeHubCollection = createCollection([]);

function runTransaction(updateFunc) {
  return updateFunc({
    get: ref => ref.get(),
    create: (ref, data) => ref.create(data),
    set: (ref, data, config) => ref.create(data, config),
    update: (ref, data) => ref.update(data),
  });
}

async function initDb() {
  return true;
}

function createDb() {
  return {
    runTransaction: updateFunc => runTransaction(updateFunc),
    batch: () => ({
      get: ref => ref.get(),
      create: (ref, data) => ref.create(data),
      set: (ref, data, config) => ref.create(data, config),
      update: (ref, data) => ref.update(data),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      commit: () => {},
    }),
  };
}

initDb();
export const db = createDb();
export const bucket = {};
