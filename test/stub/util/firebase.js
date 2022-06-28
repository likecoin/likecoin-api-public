/* eslint import/no-unresolved: "off" */
/* eslint import/extensions: "off" */
import * as admin from 'firebase-admin';
import { INFURA_HOST } from '../constant';

export { admin };
export const { FieldValue } = admin.firestore;

console.log('Using stub (firebase.js)'); /* eslint no-console: "off" */

const Web3 = require('web3');
const cloneDeep = require('lodash.clonedeep'); // eslint-disable-line import/no-extraneous-dependencies
const accounts = require('../../config/accounts.js'); // eslint-disable-line import/no-extraneous-dependencies

const userData = require('../../test/data/user.json').users;
const subscriptionData = require('../../test/data/subscription.json').subscriptions;
const txData = require('../../test/data/tx.json').tx;
const missionData = require('../../test/data/mission.json').missions;
const likerNftData = require('../../test/data/likernft.json').likernft;

const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_HOST));

function docData(obj) {
  const res = {
    ...obj,
  };
  delete res.id;
  return res;
}

function docUpdate(data, id, obj, updateData) {
  if (Object.values(updateData).some(v => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const index = data.findIndex(d => d.id === id);
  if (index === -1) throw new Error('not found');
  // eslint-disable-next-line no-param-reassign
  data[id] = Object.assign(obj, updateData);
  return global.Promise.resolve();
}

function docDelete(data, { id }) {
  const index = data.findIndex(obj => obj.id === id);
  data.splice(index, 1);
}

function docSet(data, id, setData, config) {
  if (Object.values(setData).some(v => typeof v === 'undefined')) {
    throw new Error('Some value is undefined.');
  }
  const obj = data.find(d => d.id === id);
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

function querySnapshotDocs(data, originalData) {
  const database = originalData || data;
  return data.map((d) => {
    const docObj = {
      id: d.id,
      ref: {
        set: (setData, config) => docSet(database, d.id, setData, config),
        create: (setData, config) => docSet(database, d.id, setData, config),
        update: updateData => docUpdate(database, d.id, d, updateData),
        delete: () => docDelete(database, { id: d.id }),
        collection: id => createCollection(d.collection[id]),
      },
      data: () => docData(d),
      exists: true,
    };
    return docObj;
  });
}

function collectionWhere(data, field, op, value) {
  let whereData = data;
  if (op === '==') {
    if (field.includes('.')) {
      const fields = field.split('.');
      whereData = data.filter(d => fields.reduce((acc, f) => {
        if (!acc) return acc;
        return acc[f];
      }, d));
    } else {
      whereData = data.filter(d => d[field] === value);
    }
  } else if (op === 'array-contains') {
    whereData = data.filter(d => Array.isArray(d[field]) && d[field].includes(value));
  } else if (op === '>=') {
    whereData = data.filter(d => d[field] >= value);
  } else if (op === '<=') {
    whereData = data.filter(d => d[field] <= value);
  } else if (op === '!=') {
    whereData = data.filter(d => d[field] !== value);
  } else if (op) {
    console.error(`operator ${op} is not supported`);
  }
  const docs = querySnapshotDocs(whereData, data);
  const queryObj = {
    where: (sField, sOp, sValue) => collectionWhere(whereData, sField, sOp, sValue),
    orderBy: (sField, order = 'asc') => {
      if (!data[0] || (sField in data[0] && (order === 'asc' || order === 'desc'))) {
        return queryObj;
      }
      throw new Error('orderBy is incorrect.');
    },
    startAt: () => queryObj,
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
    create: (setData, config) => docSet(data, id, setData, config),
    update: (updateData) => {
      if (obj) {
        return docUpdate(data, id, obj, updateData);
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
      /* eslint no-use-before-define: "off" */
      return createCollection(obj.collection[collectionId]);
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
export const txCollection = createCollection(txData);
export const iapCollection = createCollection([]);
export const missionCollection = createCollection(missionData);
export const couponCollection = createCollection([]);
export const configCollection = createCollection([]);
export const oAuthClientCollection = createCollection([]);
export const likeNFTCollection = createCollection(likerNftData);

function runTransaction(updateFunc) {
  return updateFunc({
    get: ref => ref.get(),
    create: (ref, data) => ref.create(data),
    set: (ref, data, config) => ref.create(data, config),
    update: (ref, data) => ref.update(data),
  });
}

async function initDb() {
  const delegatorAddress = accounts[0].address;
  const pendingCount = await web3.eth.getTransactionCount(delegatorAddress, 'pending');
  await txCollection.doc(`!counter_${delegatorAddress}`).set({ value: pendingCount });
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
      commit: () => {},
    }),
    collectionGroup: (group) => {
      let data = [];
      dbData.forEach((root) => {
        root.forEach((d) => {
          if (d.collection) {
            if (d.collection[group]) data = data.concat(d.collection[group]);
            Object.values(d.collection).forEach((c) => {
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
