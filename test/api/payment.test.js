import test from 'ava';
import BigNumber from 'bignumber.js';
import {
  testingUser2,
  testingWallet2,
  testingUser4,
  testingUser5,
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
  txHashMul2,
  txFromMul2,
  txToMul2,
  txValueMul2,
  txToIdsMul2,
  txHashMul3,
  txFromMul3,
  txToMul3,
  txValueMul3,
  txToIdMul3,
  txHashMul4,
  txFromMul4,
  txToMul4,
  txValueMul4,
  txToIdMul4,
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
  t.deepEqual(res.data.toId, txToIdsMul);
});

test('PAYMENT: Get tx (transferMultiple) by id with filter address', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHashMul}?address=${txToMul[0]}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFromMul);
  t.deepEqual(res.data.to, [txToMul[0]]);
  t.deepEqual(res.data.value, [txValueMul[0]]);
  t.deepEqual(res.data.toId, [txToIdsMul[0]]);
});

test('PAYMENT: Get tx (transferMultiple) by id with wrong filter address', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHashMul}?address=0xDEADBEEF`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFromMul);
  t.deepEqual(res.data.to, []);
  t.deepEqual(res.data.value, []);
  t.deepEqual(res.data.toId, []);
});

test('PAYMENT: Get tx (transferMultiple) by id with filter address (multiple outputs)', async (t) => {
  const res = await axiosist.get(`/api/tx/id/${txHashMul2}?address=${txToMul2[0]}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.from, txFromMul2);
  t.deepEqual(res.data.to, [txToMul2[0]]);
  t.deepEqual(
    res.data.value,
    [new BigNumber(txValueMul2[0]).plus(new BigNumber(txValueMul2[3])).toString()],
  );
  t.deepEqual(res.data.toId, [txToIdsMul2[0]]);
});

test('PAYMENT: Get tx history by addr', async (t) => {
  const token = jwtSign({ user: testingUser2, wallet: txTo });
  const res = await axiosist.get(`/api/tx/history/addr/${txTo}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.length, 1);
  // check test record exists
  t.is(res.data[0].id, txHash);
  t.is(res.data[0].from, txFrom);
  t.is(res.data[0].to, txTo);
  t.is(res.data[0].value, txValue);
});

test('PAYMENT: Get tx history (transferMultiple) by addr (single output)', async (t) => {
  const token = jwtSign({ user: testingUser5, wallet: txToMul[2] });
  const res = await axiosist.get(`/api/tx/history/addr/${txToMul[2]}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.length, 1);
  // check test record exists
  t.is(res.data[0].id, txHashMul);
  t.is(res.data[0].from, txFromMul);
  t.deepEqual(res.data[0].to, [txToMul[2]]);
  t.deepEqual(res.data[0].value, [txValueMul[2]]);
  t.deepEqual(res.data[0].toId, [txToIdsMul[2]]);
});

test('PAYMENT: Get tx history (transferMultiple) by addr (multiple output)', async (t) => {
  const token = jwtSign({ user: testingUser4, wallet: txToMul[0] });
  const res = await axiosist.get(`/api/tx/history/addr/${txToMul[0]}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.length, 4);
  const checker = {
    txHashMul: false,
    txHashMul2: false,
    txHashMul3: false,
    txHashMul4: false,
  };
  // check test record exists
  for (let i = 0; i < res.data.length; i += 1) {
    switch (res.data[i].id) {
      case txHashMul:
        t.is(res.data[i].from, txFromMul);
        t.deepEqual(res.data[i].to, [txToMul[0]]);
        t.deepEqual(res.data[i].value, [txValueMul[0]]);
        t.deepEqual(res.data[i].toId, [txToIdsMul[0]]);
        checker.txHashMul = true;
        break;
      case txHashMul2:
        t.is(res.data[i].from, txFromMul2);
        t.deepEqual(res.data[i].to, [txToMul2[0]]);
        t.deepEqual(
          res.data[i].value,
          [new BigNumber(txValueMul2[0]).plus(new BigNumber(txValueMul2[3])).toString()],
        );
        t.deepEqual(res.data[i].toId, [txToIdsMul2[0]]);
        checker.txHashMul2 = true;
        break;
      case txHashMul3:
        t.is(res.data[i].from, txFromMul3);
        t.deepEqual(res.data[i].to, txToMul3);
        t.deepEqual(res.data[i].value, txValueMul3);
        t.deepEqual(res.data[i].toId, txToIdMul3);
        checker.txHashMul3 = true;
        break;
      case txHashMul4:
        t.is(res.data[i].from, txFromMul4);
        t.deepEqual(res.data[i].to, txToMul4);
        t.deepEqual(res.data[i].value, txValueMul4);
        t.deepEqual(res.data[i].toId, txToIdMul4);
        checker.txHashMul4 = true;
        break;
      default:
        break;
    }
  }
  t.true(checker.txHashMul);
  t.true(checker.txHashMul2);
  t.true(checker.txHashMul3);
  t.true(checker.txHashMul4);
});
