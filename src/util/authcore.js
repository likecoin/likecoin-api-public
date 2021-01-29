import axios from 'axios';
import HttpAgent, { HttpsAgent } from 'agentkeepalive';
import {
  AUTHCORE_API_ENDPOINT,
  AUTHCORE_SECRETD_STATIC_KEY,
} from '../../config/config';
import { ValidationError } from './ValidationError';

const { AuthcoreVaultClient, AuthcoreCosmosProvider } = require('secretd-js');

const api = axios.create({
  baseURL: `${AUTHCORE_API_ENDPOINT}/api`,
  httpAgent: new HttpAgent(),
  httpsAgent: new HttpsAgent(),
  timeout: 10000,
});

function parseAuthCoreUser(user) {
  const {
    id: authCoreUserId,
    username: suggestedUserId,
    display_name: displayName,
    primary_email: email,
    primary_email_verified: emailVerifiedTs,
    primary_phone: phone,
    primary_phone_verified: phoneVerifiedTs,
  } = user;
  let isEmailVerified = false;
  if (typeof emailVerifiedTs === 'string') {
    isEmailVerified = emailVerifiedTs && (new Date(emailVerifiedTs)).getTime() > 0;
  } else if (typeof emailVerifiedTs === 'boolean') {
    isEmailVerified = emailVerifiedTs;
  }
  let isPhoneVerified = false;
  if (typeof phoneVerifiedTs === 'string') {
    isPhoneVerified = phoneVerifiedTs && (new Date(phoneVerifiedTs)).getTime() > 0;
  } else if (typeof phoneVerifiedTs === 'boolean') {
    isPhoneVerified = phoneVerifiedTs;
  }
  return {
    authCoreUserId,
    suggestedUserId,
    displayName,
    email,
    emailVerifiedTs,
    isEmailVerified,
    phone,
    phoneVerifiedTs,
    isPhoneVerified,
  };
}

export async function getAuthCoreUser(accessToken) {
  const { data } = await api.get('/auth/users/current', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!data) throw new Error('AUTHCORE_USER_NOT_FOUND');
  return parseAuthCoreUser(data);
}

export async function updateAuthCoreUser(payload, accessToken) {
  const {
    user: userName,
    displayName,
  } = payload;
  const user = {
    username: userName,
    display_name: displayName,
  };
  await api.put('/auth/users/current', { user }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function getAuthCoreUserById(authCoreUserId, accessToken) {
  const { data } = await api.get(`/management/users/${authCoreUserId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!data) throw new Error('AUTHCORE_USER_NOT_FOUND');
  return parseAuthCoreUser(data);
}

export async function updateAuthCoreUserById(authCoreUserId, payload, accessToken) {
  const {
    user: userName,
    displayName,
  } = payload;
  const user = {
    username: userName,
    display_name: displayName,
  };
  await api.put(`/management/users/${authCoreUserId}`, { user }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function getAuthCoreUserOAuthFactors(accessToken) {
  const { data } = await api.get('/auth/oauth_factors', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!data) throw new Error('AUTHCORE_OAUTH_ERROR');
  if (!data.oauth_factors) return [];
  const oAuthFactors = data.oauth_factors;
  return oAuthFactors.map(f => ({
    service: (f.service || 'FACEBOOK').toLowerCase(),
    userId: f.oauth_user_id,
  }));
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
  }
  if (!data) throw new Error('no response from authcore');
  if (!data.user) {
    if (data.code === 6) { // ALREADY_EXISTS
      if (data.details && data.details[0] && data.details[0].field_violations) {
        throw new ValidationError('EMAIL_ALREADY_USED');
      }
      throw new ValidationError('OAUTH_USER_ID_ALREADY_USED');
    }
    throw data;
  }
  return { ...data.user };
}

export async function getAuthCoreCosmosWallet(accessToken, userId) {
  try {
    const vaultOpt = { apiBaseURL: AUTHCORE_API_ENDPOINT, accessToken };
    if (userId) vaultOpt.staticKey = AUTHCORE_SECRETD_STATIC_KEY;
    const client = new AuthcoreVaultClient(vaultOpt);
    const cosmosProviderOpt = { client };
    if (userId) {
      const uid = await client.authcoreLookupOrCreateUser(userId);
      cosmosProviderOpt.oid = `user/${uid}/hdwallet_default`;
    }
    const cosmosProvider = new AuthcoreCosmosProvider(cosmosProviderOpt);
    const addresses = await cosmosProvider.getAddresses();
    if (!addresses || addresses.length < 1) {
      return '';
    }
    const [address] = addresses;
    return address;
  } catch (err) {
    if (err.response) {
      const { data } = err.response;
      if (data) throw data;
    }
    throw err;
  }
}

export async function createAuthCoreCosmosWalletViaUserToken(accessToken) {
  return getAuthCoreCosmosWallet(accessToken);
}

export async function createAuthCoreCosmosWalletViaServiceAccount(userId, accessToken) {
  return getAuthCoreCosmosWallet(accessToken, userId);
}
