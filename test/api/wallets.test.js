import test from 'ava';
import {
  testingUser1,
  testingUser2,
  testingWallet1,
  testingWallet2,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

test.serial('WALLETS: Get User wallets list', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/wallets/list', {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.wallets.length, 2);
  t.is(res.data.wallets[0].wallet, '0x000000000000000000000000000000000000000');
  t.is(res.data.wallets[1].wallet, testingWallet1);
});

test.serial('WALLETS: Select new current wallet', async (t) => {
  const user = testingUser1;
  let res = await axiosist.get(`/api/users/id/${user}/min`);
  t.is(res.status, 200);
  t.is(res.data.wallet, testingWallet1);

  const token = jwtSign({ user });
  res = await axiosist.post('/api/wallets/select', {
    wallet: '0x000000000000000000000000000000000000000',
  }, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  res = await axiosist.get(`/api/users/id/${user}/min`);
  t.is(res.status, 200);
  t.is(res.data.wallet, '0x000000000000000000000000000000000000000');
});

test('WALLETS: Add wallet', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  let res = await axiosist.post('/api/wallets/new', {
    wallet: '0x000000000000000000000000000000000000000',
  }, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 200);

  res = await axiosist.get('/api/wallets/list', {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.wallets.length, 2);
  t.is(res.data.wallets[0].wallet, '0x000000000000000000000000000000000000000');
  t.is(res.data.wallets[1].wallet, testingWallet2);
});
