import axios from 'axios';
import { EXTERNAL_HOSTNAME, IS_TESTNET } from '../../constant';
import { ValidationError } from '../ValidationError';
import {
  MATTERS_APP_ID,
  MATTERS_APP_SECRET,
} from '../../../config/config';

const crypto = require('crypto');
const querystring = require('querystring');

const MATTER_HOST = `${IS_TESTNET ? 'server-test.' : ''}matters.news`;
const CALLBACK_URI = `https://${EXTERNAL_HOSTNAME}/in/social/oauth/matters`;
const SCOPE = 'user:email:readonly​'; // TODO: Add email

export function fetchMattersOAuthInfo(user) {
  if (!MATTERS_APP_ID || !MATTERS_APP_SECRET) throw new ValidationError('matters app not configured');
  const state = `${user}-${crypto.randomBytes(20).toString('hex')}`;
  const url = `https://${MATTER_HOST}/oauth/authorize?client_id=${MATTERS_APP_ID}&scope=${encodeURIComponent(SCOPE)}&state=${state}&response_type=code&redirect_uri=${encodeURIComponent(CALLBACK_URI)}`;
  return { url, state };
}

export async function fetchMattersAccessToken(code) {
  if (!MATTERS_APP_ID || !MATTERS_APP_SECRET) throw new ValidationError('matters app not configured');
  const req = {
    url: `https://${MATTER_HOST}/oauth/access_token`,
    method: 'POST',
    data: {
      code,
      client_id: MATTERS_APP_ID,
      client_secret: MATTERS_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: CALLBACK_URI,
    },
  };
  const { data } = await axios({
    url: req.url,
    method: req.method,
    data: querystring.stringify(req.data),
  });
  const { access_token: accessToken, refresh_token: refreshToken } = data;
  return { accessToken, refreshToken };
}

export async function fetchMattersUser({ code, accessToken: inputToken }) {
  if (!MATTERS_APP_ID || !MATTERS_APP_SECRET) throw new ValidationError('matters app not configured');
  if (!code && !inputToken) throw new ValidationError('missing code or accessToken');
  let accessToken = inputToken;
  let refreshToken;
  if (!accessToken) ({ accessToken, refreshToken } = await fetchMattersAccessToken(code));
  if (!accessToken) throw new ValidationError('fail to get matters access token');
  const { data } = await axios.post(
    `https://${MATTER_HOST}/graphql`,
    { query: '{viewer {\nid\nuuid\nuserName\ndisplayName\navatar\ninfo{email}}}' },
    { headers: { 'x-access-token': accessToken } },
  );
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
    imageUrl: avatar,
    url: `https:/${MATTER_HOST}/@${displayName}/`,
  };
}
