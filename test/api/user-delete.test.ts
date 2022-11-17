import test from 'ava';
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

test('USER: Delete authcore user. Case: fail, no authcore token', async (t) => {
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
  t.is(res.status, 400);
});

test('USER: Delete wallet user. Case: fail, wrong user', async (t) => {
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
  t.is(res.status, 401);
});

test('USER: Delete wallet user. Case: fail, wrong wallet payload', async (t) => {
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
  t.is(res.status, 400);
});

test('USER: Delete wallet user. Case: fail, wrong time payload', async (t) => {
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
  t.is(res.status, 400);
});

test('USER: Delete wallet user. Case: fail, missing action payload', async (t) => {
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
  t.is(res.status, 400);
});

test('USER: Delete wallet user. Case: success', async (t) => {
  const likeWallet = testDeleteUserLikeWallet;
  const user = testDeleteUser;
  let res = await axiosist.get(`/api/users/id/${user}/min`);
  t.is(res.status, 200);
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
  t.is(res.status, 200);
  res = await axiosist.get(`/api/users/id/${user}/min`);
  t.is(res.status, 404);
});
