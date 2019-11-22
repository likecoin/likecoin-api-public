import axios from 'axios';
import {
  AUTHCORE_API_ENDPOINT,
  AUTHCORE_SECRETD_STATIC_KEY,
} from '../../config/config';

const { AuthcoreVaultClient, AuthcoreCosmosProvider } = require('secretd-js');

const api = axios.create({ baseURL: `${AUTHCORE_API_ENDPOINT}/api` });

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
    if (err.response) ({ data } = err.response);
    else console.error(err);
  }
  if (!data || !data.user) throw new Error(data);
  return { ...data.user };
}

export async function getAuthCoreCosmosWallet(userId, accessToken) {
  const client = new AuthcoreVaultClient({
    apiBaseURL: AUTHCORE_API_ENDPOINT,
    accessToken,
    staticKey: AUTHCORE_SECRETD_STATIC_KEY,
  });
  const uid = await client.authcoreLookupOrCreateUser(userId);
  const cosmosProvider = new AuthcoreCosmosProvider({
    client,
    oid: `user/${uid}/hdwallet_default`,
  });
  const addresses = await cosmosProvider.getAddresses();
  if (!addresses || addresses.length < 1) {
    return '';
  }
  const [address] = addresses;
  return address;
}

export async function createAuthCoreCosmosWallet(userId, accessToken) {
  return getAuthCoreCosmosWallet(userId, accessToken);
}

export async function createAuthCoreCosmosWalletIfNotExist(userId, accessToken) {
  return getAuthCoreCosmosWallet(userId, accessToken);
}
