import test from 'ava';
import {
  testingUser1,
  testingUser2,
  testingUser1Locale,
  testingUser1CreatorPitch,
} from './data';
import axiosist from './axiosist';

import { jwtSign } from './jwt';

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
  t.is(res.data.creatorPitch, testingUser1CreatorPitch);
});

test('USER: Set user preferences (Locale). Case: success', async (t) => {
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

test('USER: Set user preferences (Locale). Case: failed', async (t) => {
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

test('USER: Set user preferences (Creator pitch). Case: success', async (t) => {
  const creatorPitch = 'Oh, Hi Mark!';
  const user = testingUser2;
  const token = jwtSign({ user });
  const config = {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  };
  let res = await axiosist.post('/api/users/preferences', { creatorPitch }, config);
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/preferences', config);
  t.is(res.data.creatorPitch, creatorPitch);
});

test('USER: Update user preferences (Creator pitch). Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const config = {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  };
  let res = await axiosist.post('/api/users/preferences', {
    creatorPitch: 'Hello world',
  }, config);
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/preferences', config);
  t.is(res.data.creatorPitch, 'Hello world');

  res = await axiosist.post('/api/users/preferences', {
    creatorPitch:
      '0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九',
  }, config);
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/preferences', config);
  t.is(
    res.data.creatorPitch,
    '0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九',
  );

  res = await axiosist.post('/api/users/preferences', { creatorPitch: '' }, config);
  t.is(res.status, 200);
  res = await axiosist.get('/api/users/preferences', config);
  t.is(res.data.creatorPitch, '');
});

test('USER: Set user preferences (Creator pitch). Case: failed', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.post('/api/users/preferences', {
    creatorPitch: 123,
  }, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 400);
});

test.serial('USER: Post payment redirect whitelist. Case: Success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: [
      'http://example1.com/',
      'http://example2.com/',
      'http://example3.com/',
    ],
  };
  let res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);

  res = await axiosist.get('/api/users/preferences', {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  const { paymentRedirectWhiteList: whitelist } = res.data;
  t.is(res.status, 200);
  t.is(whitelist.length, 3);
  t.true(whitelist.includes('http://example1.com/'));
  t.true(whitelist.includes('http://example2.com/'));
  t.true(whitelist.includes('http://example3.com/'));
});

test.serial('USER: Post payment redirect whitelist with duplicated URLs. Case: Success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: [
      'http://example1.com/',
      'http://example2.com/',
      'http://example2.com/',
      'http://example3.com/',
      'http://example3.com/',
    ],
  };
  let res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);

  res = await axiosist.get('/api/users/preferences', {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  const { paymentRedirectWhiteList: whitelist } = res.data;
  t.is(res.status, 200);
  t.is(whitelist.length, 3);
  t.true(whitelist.includes('http://example1.com/'));
  t.true(whitelist.includes('http://example2.com/'));
  t.true(whitelist.includes('http://example3.com/'));
});

test.serial('USER: Empty payment redirect whitelist with empty array. Case: Success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: [],
  };
  let res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);

  res = await axiosist.get('/api/users/preferences', {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);
  t.is(res.data.paymentRedirectWhiteList.length, 0);
});

test.serial('USER: Empty payment redirect whitelist with null. Case: Success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: null,
  };
  let res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);

  res = await axiosist.get('/api/users/preferences', {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 200);
  t.is(res.data.paymentRedirectWhiteList.length, 0);
});

test('USER: Post payment redirect whitelist. Case: Invalid payload format', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: true,
  };
  const res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 400);
  t.is(res.data, 'INVALID_PAYMENT_REDIRECT_WHITELIST');
});

test('USER: Post payment redirect whitelist. Case: Invalid url format', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const payload = {
    paymentRedirectWhiteList: [
      'http://example1.com/',
      'http://example2.com/',
      'invalid string',
    ],
  };
  const res = await axiosist.post('/api/users/preferences', payload, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => (err as any).response);

  t.is(res.status, 400);
  t.is(res.data, 'INVALID_PAYMENT_REDIRECT_URL');
});
