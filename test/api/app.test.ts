// eslint-disable-next-line import/no-unresolved
import test from 'ava';
import axiosist from './axiosist';

import {
  testingUser1,
  testingUser2,
} from './data';

import { jwtSign } from './jwt';

test('app: get meta fail', async (t) => {
  const res = await axiosist.get('/api/app/meta')
    .catch((err) => (err as any).response);

  t.is(res.status, 401);
});

test('app: get meta for old user', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get(
    '/api/app/meta',
    {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    },
  ).catch((err) => (err as any).response);

  t.is(res.status, 200);
  t.is(res.data.isNew, false);
  t.is(res.data.isEmailVerified, true);
  t.is(res.data.ts, 1487467660239);
});

test.serial('app: get meta for new user', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.get(
    '/api/app/meta',
    {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    },
  ).catch((err) => (err as any).response);

  t.is(res.status, 200);
  t.is(res.data.isNew, true);
});

test.serial('app: post referral for new user', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.post(
    '/api/app/meta/referral',
    { referrer: testingUser1 },
    {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    },
  ).catch((err) => (err as any).response);

  t.is(res.status, 200);
});

test.serial('app: get meta for updated new user', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.get(
    '/api/app/meta',
    {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    },
  ).catch((err) => (err as any).response);

  t.is(res.status, 200);
  t.is(res.data.isNew, false);
});

test.serial('app: post referral fail for old user', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.post(
    '/api/app/meta/referral',
    { referrer: testingUser1 },
    {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    },
  ).catch((err) => (err as any).response);

  t.is(res.status, 400);
});
