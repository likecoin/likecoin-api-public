// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from 'vitest';
import {
  testingUser1,
  testingUser2,
  testingUser4,
  testingUser5,
} from './data';
import axiosist from './axiosist';
import { DEFAULT_FOLLOW_IDS } from '../../src/constant';

import { jwtSign } from './jwt';

describe('USER: List user follow. Case: success', () => {
  it('should list user follow', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.get('/api/users/follow/users', {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(DEFAULT_FOLLOW_IDS.length + 2);
  });
});

describe('USER: List user follow. Case: empty with default', () => {
  it('should list user follow with defaults', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const res = await axiosist.get('/api/users/follow/users', {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(DEFAULT_FOLLOW_IDS.length);
  });
});

describe('USER: Get user follow. Case: success', () => {
  it('should get user follow', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.get(`/api/users/follow/users/${testingUser2}`, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(testingUser2);
  });
});

describe('USER: Get user follow. Case: not found', () => {
  it('should return 404 for not found', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.get(`/api/users/follow/users/${testingUser5}`, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('USER: Add follow. Case: Already exists', () => {
  it('should add follow when already exists', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const res = await axiosist.post(`/api/users/follow/users/${testingUser2}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
  });
});

describe('USER: Add follow. Case: Not exists', () => {
  it('should return 404 when user not exists', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const noExistsId = 'not_exists_user';
    const res = await axiosist.post(`/api/users/follow/users/${noExistsId}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(404);
    expect(res.data).toBe('USER_NOT_FOUND');
  });
});

describe('USER: Add follow. Case: success', () => {
  it('should add follow successfully', async () => {
    const user = testingUser4;
    const token = jwtSign({ user });
    let res = await axiosist.post(`/api/users/follow/users/${testingUser1}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/follow/users', {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(DEFAULT_FOLLOW_IDS.length + 1);
    expect(res.data.list.find((l) => l.id === testingUser1).isFollowed).toBe(true);
  });
});

describe('USER: Remove follow. Case: success', () => {
  it('should remove follow successfully', async () => {
    const user = testingUser4;
    const token = jwtSign({ user });
    let res = await axiosist.delete(`/api/users/follow/users/${testingUser1}`, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    res = await axiosist.get('/api/users/follow/users', {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(DEFAULT_FOLLOW_IDS.length + 1);
    expect(res.data.list.find((l) => l.id === testingUser1).isFollowed).toBe(false);
  });
});
