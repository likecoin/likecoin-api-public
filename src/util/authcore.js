import axios from 'axios';
import {
  AUTHCORE_API_ENDPOINT,
} from '../../config/config';

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

export default getAuthCoreUser;
