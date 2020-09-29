import test from 'ava';
import {
  testingUser1,
  testingUser2,
  testingUser4,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

test('USER: List user bookmarks. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/users/bookmarks', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, 2);
});

test('USER: List user bookmarks. Case: empty', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const res = await axiosist.get('/api/users/bookmarks', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, 0);
});

test('USER: Get user bookmark. Case: by ID', async (t) => {
  const user = testingUser1;
  const bookmarkId = '785f4088-4505-4dc0-8985-f33e7ccbaa74';
  const token = jwtSign({ user });
  const res = await axiosist.get(`/api/users/bookmarks/${bookmarkId}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.url, 'https://google.com/');
});

test('USER: Get user bookmark. Case: by URL', async (t) => {
  const user = testingUser1;
  const url = 'https://google.com/';
  const token = jwtSign({ user });
  const res = await axiosist.get(`/api/users/bookmarks?url=${encodeURIComponent(url)}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.url, 'https://google.com/');
});

test('USER: Get user bookmark. Case: not found', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const bookmarkId = 'notexists';
  const res = await axiosist.get(`/api/users/bookmarks/${bookmarkId}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 404);
});

test('USER: Add bookmark. Case: Already exists', async (t) => {
  const user = testingUser1;
  const url = 'https://google.com/';
  const token = jwtSign({ user });
  const res = await axiosist.post(`/api/users/bookmarks?url=${encodeURIComponent(url)}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 409);
});


test.serial('USER: Add bookmark. Case: success', async (t) => {
  const user = testingUser4;
  const url = 'https://google.com/';
  const token = jwtSign({ user });
  let res = await axiosist.post('/api/users/bookmarks', {
    url,
  }, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/bookmarks', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, 1);
});

test.serial('USER: Remove bookmark. Case: success', async (t) => {
  const user = testingUser4;
  const url = 'https://google.com/';
  const token = jwtSign({ user });
  let res = await axiosist.delete(`/api/users/bookmarks?url=${encodeURIComponent(url)}`, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/bookmarks', {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.list.length, 0);
});
