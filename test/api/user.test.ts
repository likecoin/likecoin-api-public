// eslint-disable-next-line import/no-unresolved
import {
  describe, it, expect, vi,
} from 'vitest';
import FormData from 'form-data';
import fs from 'fs';
import { createHash } from 'crypto';
import jsonStringify from 'fast-json-stable-stringify';
import path from 'path';
import sigUtil from 'eth-sig-util';
import web3Utils from 'web3-utils';
import {
  testingCosmosWallet0,
  testingLikeWallet0,
  testingUser1,
  testingDisplayName1,
  testingEmail1,
  testingWallet1,
  testingCosmosWallet1,
  testingLikeWallet1,
  testingCivicLikerSince1,
  testingCivicLikerEnd1,
  testingUser2,
  testingEmail2,
  testingWallet2,
  invalidWallet,
  testingWallet3,
  testingCosmosWallet3,
  testingLikeWallet3,
  privateKey1,
  privateKey2,
  privateKey3,
  cosmosPrivateKeyNew,
} from './data';
import axiosist from './axiosist';
import { userCollection, FieldValue } from '../../src/util/firebase';
import { getMagicUserMetadataByDIDToken } from '../../src/util/magic';
import {
  SUBSCRIPTION_GRACE_PERIOD,
} from '../../src/constant';
import {
  signWithPrivateKey as signWithCosmos,
} from './cosmos';

import { jwtSign } from './jwt';

// Override only the network call; keep verifyEmailByMagicUserMetadata real.
vi.mock('../../src/util/magic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/magic')>();
  return {
    ...actual,
    getMagicUserMetadataByDIDToken: vi.fn(),
  };
});
const mockGetMagicMetadata = vi.mocked(getMagicUserMetadataByDIDToken);

function signERCProfile(signData, privateKey) {
  const privKey = Buffer.from(privateKey.substr(2), 'hex');
  return sigUtil.personalSign(privKey, { data: web3Utils.utf8ToHex(signData) });
}

// The stub re-seeds fixtures by reference, so an email write leaks into later
// tests; restore every email-related field a test touches (deleting ones absent
// in the snapshot) to keep the suite order-safe.
async function restoreEmailFields(user: string, before: any) {
  await userCollection.doc(user).update({
    email: before.email ?? FieldValue.delete(),
    magicUserId: before.magicUserId ?? FieldValue.delete(),
    normalizedEmail: before.normalizedEmail ?? FieldValue.delete(),
    isEmailVerified: before.isEmailVerified ?? FieldValue.delete(),
    isEmailBlacklisted: before.isEmailBlacklisted ?? FieldValue.delete(),
    isEmailDuplicated: before.isEmailDuplicated ?? FieldValue.delete(),
  });
}

describe('USER tests', () => {
  it('USER: Register cosmos user. Case: fail', async () => {
    const cosmosWallet = testingCosmosWallet0;
    const payload = {
      ts: Date.now(),
      cosmosWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, '1234000000000000000000000000000000000000000000000000000000000000');
    const res = await axiosist.post('/api/users/new', {
      signature,
      publicKey: publicKey.value,
      message: jsonStringify(message),
      from: testingCosmosWallet0,
      platform: 'cosmosWallet',
      user: 'testing-new-fail',
      email: 'test@cosmos.user',
    });
    expect(res.status).toBe(400);
  });

  it('USER: Register like user. Case: fail, platform removed', async () => {
    const likeWallet = testingLikeWallet0;
    const payload = {
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyNew);
    const res = await axiosist.post('/api/users/new', {
      signature,
      publicKey: publicKey.value,
      message: jsonStringify(message),
      from: testingLikeWallet0,
      platform: 'likeWallet',
      user: 'testing-new-user',
      email: 'test@like.user',
    });
    expect(res.status).toBe(400);
  });

  it('USER: Login like user. Case: success', async () => {
    const likeWallet = testingLikeWallet0;
    const payload = {
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyNew);
    const res = await axiosist.post('/api/users/login', {
      signature,
      publicKey: publicKey.value,
      message: jsonStringify(message),
      from: testingLikeWallet0,
      platform: 'likeWallet',
    });
    expect(res.status).toBe(200);
  });

  it('USER: Login like user. Case: fail, wrong signature', async () => {
    const likeWallet = testingLikeWallet0;
    const payload = {
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, '1234000000000000000000000000000000000000000000000000000000000000');
    const res = await axiosist.post('/api/users/login', {
      signature,
      publicKey: publicKey.value,
      message: jsonStringify(message),
      from: testingLikeWallet0,
      platform: 'likeWallet',
    });
    expect(res.status).toBe(400);
  });

  it('USER: Login like user. Case: fail, wrong platform', async () => {
    const likeWallet = testingLikeWallet0;
    const payload = {
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, '1234000000000000000000000000000000000000000000000000000000000000');
    const res = await axiosist.post('/api/users/login', {
      signature,
      publicKey: publicKey.value,
      message: jsonStringify(message),
      from: testingLikeWallet0,
      platform: 'cosmosWallet',
    });
    expect(res.status).toBe(400);
  });

  //
  // serial will run first
  //
  it('USER: Login Metamask user. Case: success', async () => {
    const payload = JSON.stringify({
      ts: Date.now(),
      evmWallet: testingWallet2,
      action: 'login',
    });
    const sign = signERCProfile(payload, privateKey2);
    const res = await axiosist.post('/api/users/login', {
      from: testingWallet2,
      platform: 'evmWallet',
      payload,
      sign,
    });
    expect(res.status).toBe(200);
  });

  it('USER: Edit user by JSON from Web. Case: success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      user,
      displayName: testingDisplayName1,
      ts: Date.now(),
      wallet: testingWallet1,
    };
    const res = await axiosist.post('/api/users/update', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
  });

  it('USER: Edit user by JSON from Web. Case: authCore user resubmitting existing email is allowed', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      user,
      displayName: testingDisplayName1,
      ts: Date.now(),
      wallet: testingWallet1,
      email: testingEmail1,
    };
    const res = await axiosist.post('/api/users/update', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
  });

  it('USER: Edit user by JSON from Web. Case: change email for wallet user', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const newEmail = 'changed-login-email@example.com';
    const before = { ...(await userCollection.doc(user).get()).data() } as any;
    try {
      const res = await axiosist.post('/api/users/update', {
        user,
        email: newEmail,
      }, {
        headers: {
          Cookie: `likecoin_auth=${token};`,
        },
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(200);
      const data = (await userCollection.doc(user).get()).data() as any;
      expect(data.email).toBe(newEmail);
      expect(data.isEmailVerified).toBe(false);
    } finally {
      await restoreEmailFields(user, before);
    }
  });

  it('USER: Edit user by JSON from Web. Case: magic DID token keeps email verified', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const newEmail = 'magic-changed-email@example.com';
    const magicUserId = 'did:ethr:0xMagicIssuer';
    const before = { ...(await userCollection.doc(user).get()).data() } as any;
    try {
      await userCollection.doc(user).update({ magicUserId });
      mockGetMagicMetadata.mockResolvedValue({ issuer: magicUserId, email: newEmail } as any);
      const res = await axiosist.post('/api/users/update', {
        user,
        email: newEmail,
        magicDIDToken: 'valid-token',
      }, {
        headers: {
          Cookie: `likecoin_auth=${token};`,
        },
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(200);
      const data = (await userCollection.doc(user).get()).data() as any;
      expect(data.email).toBe(newEmail);
      expect(data.isEmailVerified).toBe(true);
    } finally {
      await restoreEmailFields(user, before);
    }
  });

  it('USER: Edit user by JSON from Web. Case: magic DID token issuer mismatch', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const newEmail = 'magic-issuer-mismatch@example.com';
    const before = { ...(await userCollection.doc(user).get()).data() } as any;
    try {
      await userCollection.doc(user).update({ magicUserId: 'did:ethr:0xOwnIssuer' });
      mockGetMagicMetadata.mockResolvedValue({ issuer: 'did:ethr:0xOtherIssuer', email: newEmail } as any);
      const res = await axiosist.post('/api/users/update', {
        user,
        email: newEmail,
        magicDIDToken: 'valid-token',
      }, {
        headers: {
          Cookie: `likecoin_auth=${token};`,
        },
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(400);
      expect(res.data).toBe('MAGIC_USER_MISMATCH');
    } finally {
      await restoreEmailFields(user, before);
    }
  });

  it('USER: Edit user by JSON from Web. Case: magic DID token backfills missing magicUserId', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const newEmail = 'magic-no-binding@example.com';
    const issuer = 'did:ethr:0xAnyIssuer';
    const before = { ...(await userCollection.doc(user).get()).data() } as any;
    try {
      // testingUser2 has no magicUserId (migrated without it); a valid Magic
      // token whose wallet matches the account backfills the binding and verifies.
      mockGetMagicMetadata.mockResolvedValue({
        issuer, email: newEmail, publicAddress: testingWallet2,
      } as any);
      const res = await axiosist.post('/api/users/update', {
        user,
        email: newEmail,
        magicDIDToken: 'valid-token',
      }, {
        headers: {
          Cookie: `likecoin_auth=${token};`,
        },
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(200);
      const data = (await userCollection.doc(user).get()).data() as any;
      expect(data.email).toBe(newEmail);
      expect(data.magicUserId).toBe(issuer);
      expect(data.isEmailVerified).toBe(true);
    } finally {
      await restoreEmailFields(user, before);
    }
  });

  it('USER: Edit user by JSON from Web. Case: magic token from unrelated wallet rejected', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const newEmail = 'magic-wrong-wallet@example.com';
    // Without a stored magicUserId, a token whose wallet differs from the
    // account's evmWallet must not bind an unrelated Magic identity.
    mockGetMagicMetadata.mockResolvedValue({
      issuer: 'did:ethr:0xUnrelated',
      email: newEmail,
      publicAddress: '0x0000000000000000000000000000000000000001',
    } as any);
    const res = await axiosist.post('/api/users/update', {
      user,
      email: newEmail,
      magicDIDToken: 'valid-token',
    }, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('MAGIC_USER_MISMATCH');
  });

  it('USER: Edit user by JSON from Web. Case: magic token backfills magicUserId without email change', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const issuer = 'did:ethr:0xSameWallet';
    const before = { ...(await userCollection.doc(user).get()).data() } as any;
    try {
      // Resubmitting the unchanged email with a wallet-matching Magic token still
      // backfills magicUserId and re-verifies, instead of returning INVALID_PAYLOAD.
      mockGetMagicMetadata.mockResolvedValue({
        issuer, email: testingEmail2, publicAddress: testingWallet2,
      } as any);
      const res = await axiosist.post('/api/users/update', {
        user,
        email: testingEmail2,
        magicDIDToken: 'valid-token',
      }, {
        headers: {
          Cookie: `likecoin_auth=${token};`,
        },
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(200);
      const data = (await userCollection.doc(user).get()).data() as any;
      expect(data.email).toBe(testingEmail2);
      expect(data.magicUserId).toBe(issuer);
      expect(data.isEmailVerified).toBe(true);
    } finally {
      await restoreEmailFields(user, before);
    }
  });

  it('USER: Edit user by JSON from Web. Case: email already used by another user', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/update', {
      user,
      email: testingEmail1,
    }, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('EMAIL_ALREADY_USED');
  });

  it('USER: Email availability pre-check. Case: available', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/email/check', {
      email: 'brand-new-unused-email@example.com',
    }, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
  });

  it('USER: Email availability pre-check. Case: already used', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/email/check', {
      email: testingEmail1,
    }, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('EMAIL_ALREADY_USED');
  });

  it('USER: Email availability pre-check. Case: own email is self-excluded', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const res = await axiosist.post('/api/users/email/check', {
      email: testingEmail2,
    }, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
  });

  it('USER: Edit user by JSON from Web. Case: Incorrect email format', async () => {
    const user = testingUser2;
    const token = jwtSign({ user });
    const payload = {
      user,
      email: 'email',
    };
    const res = await axiosist.post('/api/users/update', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_INPUT');
  });

  it('USER: Edit user by form-data from Web. Case: invalid content-type', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = new FormData();
    payload.append('user', user);
    payload.append('displayName', testingDisplayName1);
    payload.append('ts', Date.now());
    payload.append('wallet', testingWallet1);
    payload.append('email', testingEmail1);
    const res = await axiosist.post('/api/users/update', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
        ...payload.getHeaders(),
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_PAYLOAD');
  });

  it('USER: Update avatar. Case: success', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const avatarPath = path.join(__dirname, '../data/avatar.jpg');
    const avatar = fs.readFileSync(avatarPath);
    const hash = createHash('sha256');
    hash.update(avatar);
    const avatarSHA256 = hash.digest('hex');
    const payload = new FormData();
    payload.append('user', user);
    payload.append('avatarFile', fs.createReadStream(avatarPath));
    payload.append('avatarSHA256', avatarSHA256);
    const res = await axiosist.post('/api/users/update/avatar', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
        ...payload.getHeaders(),
      },
    });

    expect(res.status).toBe(200);
  });

  it('USER: Email verification (Need restart server for clean memory data)', async () => {
    const token = jwtSign({ user: testingUser1 });
    const res = await axiosist.post(`/api/email/verify/user/${testingUser1}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    }).catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data).toBe('OK');
  });

  it('USER: Verify uuid. Case: wrong uuid', async () => {
    const token = jwtSign({ user: testingUser2 });
    const uuid = '99999999-0000-0000-0000-000000000000';
    const res = await axiosist.post(`/api/email/verify/${uuid}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    }).catch((err) => (err as any).response);
    expect(res.status).toBe(404);
  });

  it('USER: Verify uuid. Case: success (Need restart server for clean memory data)', async () => {
    const token = jwtSign({ user: testingUser2 });
    const uuid = '00000000-0000-0000-0000-000000000000';
    const res = await axiosist.post(`/api/email/verify/${uuid}`, {}, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    }).catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.wallet).toBe(testingWallet2);
  });

  it('USER: Register user by form-data from Web. Case: invalid content-type', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = new FormData();
    payload.append('user', user);
    payload.append('displayName', testingDisplayName1);
    payload.append('ts', Date.now());
    payload.append('wallet', testingWallet1);
    payload.append('email', testingEmail1);
    payload.append('platform', 'wallet');
    const res = await axiosist.post('/api/users/new', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
        ...payload.getHeaders(),
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_CONTENT_TYPE');
  });

  it('USER: Register user by form-data from App. Case: invalid platform', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = new FormData();
    payload.append('user', user);
    payload.append('displayName', testingDisplayName1);
    payload.append('ts', Date.now());
    payload.append('wallet', testingWallet1);
    payload.append('email', testingEmail1);
    payload.append('platform', 'wallet');
    const res = await axiosist.post('/api/users/new', payload, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
        'User-Agent': 'LikeCoinApp',
        ...payload.getHeaders(),
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_PLATFORM');
  });

  //
  // concurrent cases
  //
  const expiredDate = new Date();
  expiredDate.setDate(expiredDate.getDate() - 1);
  const userCases = [
    {
      name: 'USER: Register or edit user. Case: wrong wallet',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        evmWallet: testingWallet1,
        email: testingEmail1,
      },
      from: testingWallet2,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: wrong wallet (ii)',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet2,
        email: testingEmail1,
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: wrong wallet (iii)',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: invalidWallet,
        email: testingEmail1,
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: expired',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: expiredDate.getTime(),
        wallet: testingWallet1,
        email: testingEmail1,
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: invalid email',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet1,
        email: 'invalid@@mail',
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: invalid email (ii)',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet1,
        email: 'invalidmail',
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: invalid email (iii)',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet1,
        email: '@likecoin.store',
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: User, wallet already exist',
      payload: {
        user: testingUser2,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet1,
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: Email already exist',
      payload: {
        user: testingUser1,
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet1,
        email: testingEmail2,
      },
      from: testingWallet1,
      privateKey: privateKey1,
    },
    {
      name: 'USER: Register or edit user. Case: Invalid user name char',
      payload: {
        user: 'Helloworld',
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet3,
      },
      from: testingWallet3,
      privateKey: privateKey3,
    },
    {
      name: 'USER: Register or edit user. Case: Invalid user name length',
      payload: {
        user: 'hello',
        displayName: testingDisplayName1,
        ts: Date.now(),
        wallet: testingWallet3,
      },
      from: testingWallet3,
      privateKey: privateKey3,
    },
  ];

  for (let i = 0; i < userCases.length; i += 1) {
    const {
      name,
      payload,
      from,
      privateKey,
    } = userCases[i];
    it(name, async () => {
      const formatedPayload = JSON.stringify(payload);
      const sign = signERCProfile(formatedPayload, privateKey);
      const res = await axiosist.post('/api/users/new', {
        from,
        payload: formatedPayload,
        sign,
        platform: 'wallet',
      }).catch((err) => (err as any).response);

      expect(res.status).toBe(400);
    });
  }

  it('USER: Get user by id', async () => {
    const user = testingUser1;
    const token = jwtSign({ user });
    let res = await axiosist.get(`/api/users/id/${user}`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(401);

    res = await axiosist.get(`/api/users/id/${user}`, {
      headers: {
        Cookie: `likecoin_auth=${token};`,
      },
    }).catch(
      // eslint-disable-next-line no-console
      (err) => console.log(err),
    );
    expect(res.status).toBe(200);
    expect(res.data.wallet).toBe(testingWallet1);
    expect(res.data.displayName).toBe(testingDisplayName1);
  });

  it('USER: Get user by id min', async () => {
    const user = testingUser1;
    const res = await axiosist.get(`/api/users/id/${user}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.wallet).toBe(testingWallet1);
    expect(res.data.email).not.toBe(testingEmail1);
  });

  it('USER: Get user by address min', async () => {
    let wallet = testingWallet1;
    let res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.wallet).toBe(testingWallet1);
    expect(res.data.email).not.toBe(testingEmail1);

    wallet = testingCosmosWallet1;
    res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.cosmosWallet).toBe(wallet);
    expect(res.data.displayName).toBe(testingDisplayName1);
    expect(res.data.email).not.toBe(testingEmail1);

    wallet = testingLikeWallet1;
    res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.likeWallet).toBe(wallet);
    expect(res.data.displayName).toBe(testingDisplayName1);
    expect(res.data.email).not.toBe(testingEmail1);

    res = await axiosist.get('/api/users/addr/0xazdfsadf/min')
      .catch((err) => (err as any).response);

    expect(res.status).toBe(400);

    wallet = testingWallet3;
    res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(404);

    wallet = testingCosmosWallet3;
    res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(404);

    wallet = testingLikeWallet3;
    res = await axiosist.get(`/api/users/addr/${wallet}/min`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(404);
  });

  it('USER: check user login status', async () => {
    const wallet = testingWallet1;
    const user = testingUser1;
    const token = jwtSign({ user, wallet });
    let res = await axiosist.get('/api/users/self')
      .catch((err) => (err as any).response);

    expect(res.status).toBe(401);

    res = await axiosist.get('/api/users/self', {
      headers: {
        Cookie: `likecoin_auth=${token}`,
      },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.isCivicLikerTrial).toBe(true);
    expect(res.data.isSubscribedCivicLiker).toBeUndefined();
    expect(res.data.isHonorCivicLiker).toBe(true);
    expect(res.data.isCivicLikerRenewalPeriod).toBe(false);
    expect(res.data.civicLikerSince).toBe(testingCivicLikerSince1);
    expect(res.data.civicLikerRenewalPeriodLast).toBe(
      testingCivicLikerEnd1 + SUBSCRIPTION_GRACE_PERIOD,
    );
  });

  it('USER: Check New User Info: Available', async () => {
    const user = `${testingUser2}-new`;
    const email = 'newemail@email.com';
    const res = await axiosist.post('/api/users/new/check', {
      user,
      email,
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
  });

  it('USER: Check New User Info: User already exist', async () => {
    const user = testingUser2;
    const email = testingEmail2;
    const res = await axiosist.post('/api/users/new/check', {
      user,
      email,
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('USER_ALREADY_EXIST');
    expect(res.data.alternative).toMatch(new RegExp(`${testingUser2}.+`));
  });

  it('USER: Check New User Info: Email Already exist', async () => {
    const user = `${testingUser2}-new`;
    const email = testingEmail2;
    const res = await axiosist.post('/api/users/new/check', {
      user,
      email,
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('EMAIL_ALREADY_USED');
  });
});
