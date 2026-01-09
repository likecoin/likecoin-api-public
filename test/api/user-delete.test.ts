import { describe, it, expect } from 'vitest';
import jsonStringify from 'fast-json-stable-stringify';
import {
  testingUser1,
  testingLikeWallet1,
  testDeleteUser,
  testDeleteUserLikeWallet,
  cosmosPrivateKeyNew,
  cosmosPrivateKeyDelete,
} from './data';
import axiosist from './axiosist';
import {
  signWithPrivateKey as signWithCosmos,
} from './cosmos';

import { jwtSign } from './jwt';

describe('USER: Delete user', () => {
  it('Delete authcore user. Case: fail, no authcore token', async () => {
    const likeWallet = testingLikeWallet1;
    const user = testingUser1;
    const token = jwtSign({ user });
    const payload = {
      action: 'user_delete',
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyDelete);
    const res = await axiosist.post(`/api/users/delete/${user}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(400);
  });

  it('Delete wallet user. Case: fail, wrong user', async () => {
    const likeWallet = testDeleteUserLikeWallet;
    const user = testDeleteUser;
    const token = jwtSign({ user });
    const payload = {
      action: 'user_delete',
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyDelete);
    const res = await axiosist.post(`/api/users/delete/${testingUser1}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it('Delete wallet user. Case: fail, wrong wallet payload', async () => {
    const likeWallet = testDeleteUserLikeWallet;
    const user = testDeleteUser;
    const token = jwtSign({ user });
    const payload = {
      action: 'user_delete',
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyNew);
    const res = await axiosist.post(`/api/users/delete/${user}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(400);
  });

  it('Delete wallet user. Case: fail, wrong time payload', async () => {
    const likeWallet = testDeleteUserLikeWallet;
    const user = testDeleteUser;
    const token = jwtSign({ user });
    const payload = {
      action: 'user_delete',
      ts: 0,
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyDelete);
    const res = await axiosist.post(`/api/users/delete/${user}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(400);
  });

  it('Delete wallet user. Case: fail, missing action payload', async () => {
    const likeWallet = testDeleteUserLikeWallet;
    const user = testDeleteUser;
    const token = jwtSign({ user });
    const payload = {
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyDelete);
    const res = await axiosist.post(`/api/users/delete/${user}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(400);
  });

  it('Delete wallet user. Case: success', async () => {
    const likeWallet = testDeleteUserLikeWallet;
    const user = testDeleteUser;
    let res = await axiosist.get(`/api/users/id/${user}/min`);
    expect(res.status).toBe(200);
    const token = jwtSign({ user });
    const payload = {
      action: 'user_delete',
      ts: Date.now(),
      likeWallet,
    };
    const {
      signed: message,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos(payload, cosmosPrivateKeyDelete);
    res = await axiosist.post(`/api/users/delete/${user}`, {
      signature: {
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
      },
    }, {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
    expect(res.status).toBe(200);
    res = await axiosist.get(`/api/users/id/${user}/min`);
    expect(res.status).toBe(404);
  });
});
