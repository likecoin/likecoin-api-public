import test from 'ava';
import {
  testingUser1,
  testingUser1Locale,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

test('USER: Get user preferences. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/users/preferences', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.locale, testingUser1Locale);
});

test('USER: Set user preferences. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.post('/api/users/preferences', { locale: 'zh' }, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
});

test('USER: Set user preferences. Case: failed', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.post('/api/users/preferences', { locale: 'xy' }, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 400);
});
