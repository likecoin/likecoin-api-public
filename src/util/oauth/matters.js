import axios from 'axios';
import { EXTERNAL_HOSTNAME } from '../../constant';
import { ValidationError } from '../ValidationError';
import {
  MATTERS_APP_ID,
  MATTERS_APP_SECRET,
} from '../../../config/config';

const crypto = require('crypto');
const querystring = require('querystring');

const CALLBACK_URI = `https://${EXTERNAL_HOSTNAME}/in/social/oauth/matters`;
const SCOPE = ''; // TODO: Add email

export function fetchMattersOAuthInfo(user) {
  if (!MATTERS_APP_ID || !MATTERS_APP_SECRET) throw new ValidationError('matters app not configured');
  const state = `${user}-${crypto.randomBytes(20).toString('hex')}`;
  const url = `https://server-test.matters.news/oauth/authorize?client_id=${MATTERS_APP_ID}&scope=${SCOPE}&state=${state}&response_type=code&redirect_uri=${encodeURIComponent(CALLBACK_URI)}`;
  return { url, state };
}

export async function fetchMattersUser(code) {
  if (!MATTERS_APP_ID || !MATTERS_APP_SECRET) throw new ValidationError('matters app not configured');
  const req = {
    url: 'https://server-test.matters.news/oauth/access_token',
    method: 'POST',
    data: {
      code,
      client_id: MATTERS_APP_ID,
      client_secret: MATTERS_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: CALLBACK_URI,
    },
  };
  let { data } = await axios({
    url: req.url,
    method: req.method,
    data: querystring.stringify(req.data),
  });
  const { access_token: accessToken, refresh_token: refreshToken } = data;
  if (!accessToken) throw new ValidationError('fail to get matters access token');
  ({ data } = await axios.post(
    'https://server-test.matters.news/graphql',
    { query: '{viewer {\nid\nuuid\nuserName\ndisplayName\navatar\ninfo{\nemail\n}\n}\n}}' },
    { headers: { 'x-access-token': accessToken } },
  ));
  if (!data || !data.data) throw new ValidationError('fail to get matters user data');
  const {
    id: userId,
    userName: displayName,
    displayName: fullName,
    avatar,
    info: { email },
  } = data.data.viewer;
  return {
    accessToken,
    refreshToken,
    userId,
    email,
    displayName,
    fullName,
    avatar,
    url: `https://matters.news/@${displayName}/`,
  };
}
