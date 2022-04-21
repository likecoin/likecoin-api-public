import test from 'ava';
import FormData from 'form-data';
import fs from 'fs';
import { createHash } from 'crypto';
import jsonStringify from 'fast-json-stable-stringify';
import {
  testingUser1,
  testingDisplayName1,
  testingEmail1,
  testingWallet1,
  testingCivicLikerSince1,
  testingCivicLikerEnd1,
  testingUser2,
  testingEmail2,
  testingWallet2,
  invalidWallet,
  testingWallet3,
  privateKey1,
  privateKey3,
} from './data';
import axiosist from './axiosist';
import {
  SUBSCRIPTION_GRACE_PERIOD,
} from '../../src/constant';
import {
  TEST_COSMOS_ADDRESS,
  TEST_LIKE_ADDRESS,
  TEST_COSMOS_PRIVATE_KEY,
  signWithPrivateKey as signWithCosmos,
} from './cosmos';

const path = require('path');
const sigUtil = require('eth-sig-util');
const Web3 = require('web3');
const { jwtSign } = require('./jwt');

function signERCProfile(signData, privateKey) {
  const privKey = Buffer.from(privateKey.substr(2), 'hex');
  return sigUtil.personalSign(privKey, { data: signData });
}

test.serial('USER: Register cosmos user. Case: fail', async (t) => {
  const cosmosWallet = TEST_COSMOS_ADDRESS;
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
    from: TEST_COSMOS_ADDRESS,
    platform: 'cosmosWallet',
    user: 'testing-new-fail',
    email: 'test@cosmos.user',
  });
  t.is(res.status, 400);
});

test.serial('USER: Register cosmos user. Case: success', async (t) => {
  const cosmosWallet = TEST_COSMOS_ADDRESS;
  const payload = {
    ts: Date.now(),
    cosmosWallet,
  };
  const {
    signed: message,
    signature: { signature, pub_key: publicKey },
  } = signWithCosmos(payload, TEST_COSMOS_PRIVATE_KEY);
  const res = await axiosist.post('/api/users/new', {
    signature,
    publicKey: publicKey.value,
    message: jsonStringify(message),
    from: TEST_COSMOS_ADDRESS,
    platform: 'cosmosWallet',
    user: 'testing-new-user',
    email: 'test@cosmos.user',
  });
  t.is(res.status, 200);
});

test.serial('USER: Login cosmos user. Case: sucess', async (t) => {
  const cosmosWallet = TEST_COSMOS_ADDRESS;
  const payload = {
    ts: Date.now(),
    cosmosWallet,
  };
  const {
    signed: message,
    signature: { signature, pub_key: publicKey },
  } = signWithCosmos(payload, TEST_COSMOS_PRIVATE_KEY);
  const res = await axiosist.post('/api/users/login', {
    signature,
    publicKey: publicKey.value,
    message: jsonStringify(message),
    from: TEST_COSMOS_ADDRESS,
    platform: 'cosmosWallet',
  });
  t.is(res.status, 200);
});

test.serial('USER: Login cosmos user. Case: fail', async (t) => {
  const cosmosWallet = TEST_COSMOS_ADDRESS;
  const payload = {
    ts: Date.now(),
    cosmosWallet,
  };
  const {
    signed: message,
    signature: { signature, pub_key: publicKey },
  } = signWithCosmos(payload, '1234000000000000000000000000000000000000000000000000000000000000');
  const res = await axiosist.post('/api/users/login', {
    signature,
    publicKey: publicKey.value,
    message: jsonStringify(message),
    from: TEST_COSMOS_ADDRESS,
    platform: 'cosmosWallet',
  });
  t.is(res.status, 400);
});

test.serial('USER: Login like user. Case: sucess', async (t) => {
  const likeWallet = TEST_LIKE_ADDRESS;
  const payload = {
    ts: Date.now(),
    likeWallet,
  };
  const {
    signed: message,
    signature: { signature, pub_key: publicKey },
  } = signWithCosmos(payload, TEST_COSMOS_PRIVATE_KEY);
  const res = await axiosist.post('/api/users/login', {
    signature,
    publicKey: publicKey.value,
    message: jsonStringify(message),
    from: TEST_LIKE_ADDRESS,
    platform: 'likeWallet',
  });
  t.is(res.status, 200);
});

test.serial('USER: Login like user. Case: fail, wrong signature', async (t) => {
  const likeWallet = TEST_LIKE_ADDRESS;
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
    from: TEST_LIKE_ADDRESS,
    platform: 'likeWallet',
  });
  t.is(res.status, 400);
});


test.serial('USER: Login like user. Case: fail, wrong platform', async (t) => {
  const likeWallet = TEST_LIKE_ADDRESS;
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
    from: TEST_LIKE_ADDRESS,
    platform: 'cosmosWallet',
  });
  t.is(res.status, 400);
});

//
// serial will run first
//
test.serial('USER: Login Metamask user. Case: success', async (t) => {
  const payload = Web3.utils.utf8ToHex(JSON.stringify({
    ts: Date.now(),
    wallet: testingWallet1,
  }));
  const sign = signERCProfile(payload, privateKey1);
  const res = await axiosist.post('/api/users/login', {
    from: testingWallet1,
    platform: 'wallet',
    payload,
    sign,
  });
  t.is(res.status, 200);
});

test.serial('USER: Edit user by JSON from Web. Case: success', async (t) => {
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
  }).catch(err => err.response);

  t.is(res.status, 200);
});

test.serial('USER: Edit user by JSON from Web. Case: editing existing email', async (t) => {
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
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data, 'EMAIL_CANNOT_BE_CHANGED');
});

test.serial('USER: Edit user by form-data from Web. Case: invalid content-type', async (t) => {
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
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data, 'INVALID_PAYLOAD');
});

test.serial('USER: Update avatar. Case: success', async (t) => {
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

  t.is(res.status, 200);
});

test.serial('USER: Email verification (Need restart server for clean memory data)', async (t) => {
  const token = jwtSign({ user: testingUser1 });
  const res = await axiosist.post(`/api/email/verify/user/${testingUser1}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data, 'OK');
});

test.serial('USER: Verify uuid. Case: wrong uuid', async (t) => {
  const token = jwtSign({ user: testingUser2 });
  const uuid = '99999999-0000-0000-0000-000000000000';
  const res = await axiosist.post(`/api/email/verify/${uuid}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 404);
});

test.serial('USER: Verify uuid. Case: success (Need restart server for clean memory data)', async (t) => {
  const token = jwtSign({ user: testingUser2 });
  const uuid = '00000000-0000-0000-0000-000000000000';
  const res = await axiosist.post(`/api/email/verify/${uuid}`, {}, {
    headers: {
      Accept: 'application/json',
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.wallet, testingWallet2);
});

test.serial('USER: Register user by form-data from Web. Case: invalid content-type', async (t) => {
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
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data, 'INVALID_CONTENT_TYPE');
});

test.serial('USER: Register user by form-data from App. Case: invalid platform', async (t) => {
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
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data, 'INVALID_PLATFORM');
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
      wallet: testingWallet1,
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
  test(name, async (t) => {
    const formatedPayload = Web3.utils.utf8ToHex(JSON.stringify(payload));
    const sign = signERCProfile(formatedPayload, privateKey);
    const res = await axiosist.post('/api/users/new', {
      from,
      payload: formatedPayload,
      sign,
      platform: 'wallet',
    }).catch(err => err.response);

    t.is(res.status, 400);
  });
}

test('USER: Get user by id', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  let res = await axiosist.get(`/api/users/id/${user}`)
    .catch(err => err.response);

  t.is(res.status, 401);

  res = await axiosist.get(`/api/users/id/${user}`, {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  }).catch(err => console.log(err));
  t.is(res.status, 200);
  t.is(res.data.wallet, testingWallet1);
  t.is(res.data.displayName, testingDisplayName1);
});

test('USER: Get user by id min', async (t) => {
  const user = testingUser1;
  const res = await axiosist.get(`/api/users/id/${user}/min`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.wallet, testingWallet1);
  t.not(res.data.email, testingEmail1);
});

test('USER: Get user by address min', async (t) => {
  let wallet = testingWallet1;
  let res = await axiosist.get(`/api/users/addr/${wallet}/min`)
    .catch(err => err.response);

  t.is(res.status, 200);

  res = await axiosist.get('/api/users/addr/0xazdfsadf/min')
    .catch(err => err.response);

  t.is(res.status, 400);

  wallet = testingWallet3;
  res = await axiosist.get(`/api/users/addr/${wallet}/min`)
    .catch(err => err.response);

  t.is(res.status, 404);
});

test('USER: check user login status', async (t) => {
  const wallet = testingWallet1;
  const user = testingUser1;
  const token = jwtSign({ user, wallet });
  let res = await axiosist.get('/api/users/self')
    .catch(err => err.response);

  t.is(res.status, 401);

  res = await axiosist.get('/api/users/self', {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.isCivicLikerTrial, true);
  t.is(res.data.isSubscribedCivicLiker, undefined);
  t.is(res.data.isHonorCivicLiker, true);
  t.is(res.data.isCivicLikerRenewalPeriod, false);
  t.is(res.data.civicLikerSince, testingCivicLikerSince1);
  t.is(res.data.civicLikerRenewalPeriodLast, testingCivicLikerEnd1 + SUBSCRIPTION_GRACE_PERIOD);
});

test('USER: Post user notitication option', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  let res = await axiosist.post(`/api/users/email/${user}`, {
    isEmailEnabled: true,
  }, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  res = await axiosist.get(`/api/users/id/${user}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.isEmailEnabled, true);
});

test('USER: Check New User Info: Available', async (t) => {
  const user = `${testingUser2}-new`;
  const email = 'newemail@email.com';
  const res = await axiosist.post('/api/users/new/check', {
    user,
    email,
  }).catch(err => err.response);

  t.is(res.status, 200);
});

test('USER: Check New User Info: User already exist', async (t) => {
  const user = testingUser2;
  const email = testingEmail2;
  const res = await axiosist.post('/api/users/new/check', {
    user,
    email,
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data.error, 'USER_ALREADY_EXIST');
  t.regex(res.data.alternative, new RegExp(`${testingUser2}.+`));
});

test('USER: Check New User Info: Email Already exist', async (t) => {
  const user = `${testingUser2}-new`;
  const email = testingEmail2;
  const res = await axiosist.post('/api/users/new/check', {
    user,
    email,
  }).catch(err => err.response);

  t.is(res.status, 400);
  t.is(res.data.error, 'EMAIL_ALREADY_USED');
});
