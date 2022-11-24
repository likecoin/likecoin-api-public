// eslint-disable-next-line import/no-unresolved
import test from 'ava';
import {
  testingUser1,
  testingUser2,
  testingUser4,
  testingUser5,
} from './data';
import axiosist from './axiosist';
import { DEFAULT_FOLLOW_IDS } from '../../src/constant';

import { jwtSign } from './jwt';

test('USER: List user follow. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/users/follow/users', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, DEFAULT_FOLLOW_IDS.length + 2);
});

test('USER: List user follow. Case: empty with default', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/users/follow/users', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, DEFAULT_FOLLOW_IDS.length);
});

test('USER: Get user follow. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get(`/api/users/follow/users/${testingUser2}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.id, testingUser2);
});

test('USER: Get user follow. Case: not found', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get(`/api/users/follow/users/${testingUser5}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 404);
});

test('USER: Add follow. Case: Already exists', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.post(`/api/users/follow/users/${testingUser2}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
});

test('USER: Add follow. Case: Not exists', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const noExistsId = 'not_exists_user';
  const res = await axiosist.post(`/api/users/follow/users/${noExistsId}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 404);
  t.is(res.data, 'USER_NOT_FOUND');
});

test.serial('USER: Add follow. Case: success', async (t) => {
  const user = testingUser4;
  const token = jwtSign({ user });
  let res = await axiosist.post(`/api/users/follow/users/${testingUser1}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/follow/users', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, DEFAULT_FOLLOW_IDS.length + 1);
  t.is(res.data.list.find((l) => l.id === testingUser1).isFollowed, true);
});

test.serial('USER: Remove follow. Case: success', async (t) => {
  const user = testingUser4;
  const token = jwtSign({ user });
  let res = await axiosist.delete(`/api/users/follow/users/${testingUser1}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/follow/users', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, DEFAULT_FOLLOW_IDS.length + 1);
  t.is(res.data.list.find((l) => l.id === testingUser1).isFollowed, false);
});
