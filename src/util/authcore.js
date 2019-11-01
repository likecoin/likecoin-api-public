import axios from 'axios';
import {
  AUTHCORE_API_ENDPOINT,
} from '../../config/config';

const hdkey = require('hdkey');
const bech32 = require('bech32');

const api = axios.create({ baseURL: AUTHCORE_API_ENDPOINT });

export async function getAuthCoreUser(accessToken) {
  const { data } = await api.get('/auth/users/current', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!data) throw new Error('AUTHCORE_USER_NOT_FOUND');
  const {
    id: authcoreUserId,
    username: suggestedUserId,
    display_name: displayName,
    primary_email: email,
    primary_email_verified: emailVerifiedTs,
  } = data;
  return {
    authcoreUserId,
    suggestedUserId,
    displayName,
    email,
    emailVerifiedTs,
    isEmailVerified: !!emailVerifiedTs,
  };
}

export async function registerAuthCoreUser(payload, accessToken) {
  let data;
  try {
    ({ data } = await api.post('/management/users', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
  } catch (err) {
    console.error(JSON.stringify(err.response.data));
  }
  if (!data || !data.user) throw new Error(data);
  return { ...data.user };
}

export async function getAuthCoreCosmosWallet(userId, accessToken) {
  const { data: listData } = await api.post('/keyvault/operation', {
    list_hd_child_public_keys: {
      path: "m/44'/118'/0'/0/0",
      as_user: userId,
    },
  }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!listData
    || !listData.hd_child_public_keys
    || listData.hd_child_public_keys.length < 1) {
    return '';
  }
  const [key] = listData.hd_child_public_keys;
  const xpub = hdkey.fromExtendedKey(key.extended_public_key);
  const address = bech32.encode('cosmos', bech32.toWords(xpub.identifier));
  return address;
}

export async function createAuthCoreCosmosWallet(userId, accessToken) {
  await api.post('/keyvault/operation',
    {
      create_secret: {
        type: 'HD_KEY',
        size: 24,
        as_user: userId,
      },
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  const address = await getAuthCoreCosmosWallet(userId, accessToken);
  return address;
}

export async function createAuthCoreCosmosWalletIfNotExist(userId, accessToken) {
  let address = await getAuthCoreCosmosWallet(userId, accessToken);
  if (address) return address;
  address = await createAuthCoreCosmosWallet(userId, accessToken);
  return address;
}
