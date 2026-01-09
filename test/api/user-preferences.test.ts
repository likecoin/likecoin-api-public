import { describe, it, expect } from 'vitest';
import {
  testingUser1,
  testingUser2,
  testingUser1Locale,
  testingUser1CreatorPitch,
} from './data';
import axiosist from './axiosist';

import { jwtSign } from './jwt';

describe('USER: Get user preferences', () => {
  it('Get user preferences. Case: success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.get('/api/users/preferences', {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.locale).toBe(testingUser1Locale);
    expect(res.data.creatorPitch).toBe(testingUser1CreatorPitch);
  });
});

describe('USER: Set user preferences (Locale)', () => {
  it('Set user preferences (Locale). Case: success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/preferences', { locale: 'zh' }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it('Set user preferences (Locale). Case: failed', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/preferences', { locale: 'xy' }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('USER: Set user preferences (Creator pitch)', () => {
  it('Set user preferences (Creator pitch). Case: success', async () => {
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
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/preferences', config);
    expect(res.data.creatorPitch).toBe(creatorPitch);
  });

  it('Update user preferences (Creator pitch). Case: success', async () => {
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
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/preferences', config);
    expect(res.data.creatorPitch).toBe('Hello world');

    res = await axiosist.post('/api/users/preferences', {
      creatorPitch:
        '0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九',
    }, config);
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/preferences', config);
    expect(
      res.data.creatorPitch,
    ).toBe(
      '0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九0123456789零一二三四五六七八九',
    );

    res = await axiosist.post('/api/users/preferences', { creatorPitch: '' }, config);
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/preferences', config);
    expect(res.data.creatorPitch).toBe('');
  });

  it('Set user preferences (Creator pitch). Case: failed', async () => {
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
    expect(res.status).toBe(400);
  });
});

describe('USER: Post payment redirect whitelist', () => {
  it('Post payment redirect whitelist. Case: Success', async () => {
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
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);

    res = await axiosist.get('/api/users/preferences', {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    const { paymentRedirectWhiteList: whitelist } = res.data;
    expect(res.status).toBe(200);
    expect(whitelist.length).toBe(3);
    expect(whitelist.includes('http://example1.com/')).toBe(true);
    expect(whitelist.includes('http://example2.com/')).toBe(true);
    expect(whitelist.includes('http://example3.com/')).toBe(true);
  });

  it('Post payment redirect whitelist with duplicated URLs. Case: Success', async () => {
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
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);

    res = await axiosist.get('/api/users/preferences', {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    const { paymentRedirectWhiteList: whitelist } = res.data;
    expect(res.status).toBe(200);
    expect(whitelist.length).toBe(3);
    expect(whitelist.includes('http://example1.com/')).toBe(true);
    expect(whitelist.includes('http://example2.com/')).toBe(true);
    expect(whitelist.includes('http://example3.com/')).toBe(true);
  });

  it('Empty payment redirect whitelist with empty array. Case: Success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      paymentRedirectWhiteList: [],
    };
    let res = await axiosist.post('/api/users/preferences', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);

    res = await axiosist.get('/api/users/preferences', {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.paymentRedirectWhiteList.length).toBe(0);
  });

  it('Empty payment redirect whitelist with null. Case: Success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      paymentRedirectWhiteList: null,
    };
    let res = await axiosist.post('/api/users/preferences', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);

    res = await axiosist.get('/api/users/preferences', {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.paymentRedirectWhiteList.length).toBe(0);
  });

  it('Post payment redirect whitelist. Case: Invalid payload format', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      paymentRedirectWhiteList: true,
    };
    const res = await axiosist.post('/api/users/preferences', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_PAYMENT_REDIRECT_WHITELIST');
  });

  it('Post payment redirect whitelist. Case: Invalid url format', async () => {
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
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_PAYMENT_REDIRECT_URL');
  });
});
