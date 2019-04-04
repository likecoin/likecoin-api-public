import test from 'ava';
import {
  testingUser2,
  testingWallet2,
  testingUser4,
  invalidWallet,
  txHash,
  txFrom,
  txTo,
  txValue,
  txHashMul,
  txFromMul,
  txToMul,
  txValueMul,
  txToIdsMul,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

test('PAYMENT: Payment. Case: Login needed.', async (t) => {
  const res = await axiosist.post('/api/payment', {
    from: txFrom,
    to: invalidWallet,
    value: 1,
    maxReward: 0,
    nonce: 1,
    signature: '',
  }, {
    headers: {
      Accept: 'application/json',
    },
  }).catch(err => err.response);
  t.is(res.status, 401);
});

test('PAYMENT: Payment. Case: Invalid address.', async (t) => {
  const token = jwtSign({ user: testingUser2, wallet: txTo });
  const res = await axiosist.post('/api/payment', {
    from: testingWallet2,
    to: invalidWallet,
    value: 1,
    maxReward: 0,
    nonce: 1,
    signature: '',
  }, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
      Accept: 'application/json',
    },
  }).catch(err => err.response);
  t.is(res.status, 400);
});

test('PAYMENT: Get tx by id', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHash}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFrom);
  t.is(res.data.to, txTo);
  t.is(res.data.value, txValue);
});

test('PAYMENT: Get tx (transferMultiple) by id', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHashMul}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFromMul);
  t.deepEqual(res.data.to, txToMul);
  t.deepEqual(res.data.value, txValueMul);
  t.deepEqual(res.data.toIds, txToIdsMul);
  t.is(res.data.toId, undefined);
});

test('PAYMENT: Get tx (transferMultiple) by id with filter address', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHashMul}?address=${txToMul[0]}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFromMul);
  t.deepEqual(res.data.to, [txToMul[0]]);
  t.deepEqual(res.data.value, [txValueMul[0]]);
  t.deepEqual(res.data.toIds, [txToIdsMul[0]]);
  t.is(res.data.toId, txToIdsMul[0]);
});

test('PAYMENT: Get tx history by addr', async (t) => {
  const token = jwtSign({ user: testingUser2, wallet: txTo });
  const res = await axiosist.get(`/api/tx/history/addr/${txTo}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  // check test record exists
  for (let i = 0; i < res.data.length; i += 1) {
    if (res.data[i].id === txHash) {
      t.is(res.data[i].from, txFrom);
      t.is(res.data[i].to, txTo);
      t.is(res.data[i].value, txValue);
    }
  }
});

test('PAYMENT: Get tx history (transferMultiple) by addr', async (t) => {
  const token = jwtSign({ user: testingUser4, wallet: txToMul[0] });
  const res = await axiosist.get(`/api/tx/history/addr/${txToMul[0]}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  // check test record exists
  for (let i = 0; i < res.data.length; i += 1) {
    if (res.data[i].id === txHashMul) {
      t.is(res.data[i].from, txFromMul);
      t.deepEqual(res.data[i].to, [txToMul[0]]);
      t.deepEqual(res.data[i].value, [txValueMul[0]]);
      t.deepEqual(res.data[i].toIds, [txToIdsMul[0]]);
      t.is(res.data[i].toId, txToIdsMul[0]);
    }
  }
});
