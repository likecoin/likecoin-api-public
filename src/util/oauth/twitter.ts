import axios from 'axios';
import crypto from 'crypto';
import querystring from 'querystring';
import OAuth from 'oauth-1.0a';
import { EXTERNAL_HOSTNAME } from '../../constant';
import { ValidationError } from '../ValidationError';
import {
  TWITTER_API_KEY,
  TWITTER_API_SECRET,
} from '../../../config/config';

const oauth = new OAuth({
  consumer: {
    key: TWITTER_API_KEY,
    secret: TWITTER_API_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function: (text, key) => crypto.createHmac('sha1', key).update(text).digest('base64'),
});

export async function fetchTwitterOAuthInfo(user) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET) throw new ValidationError('twitter app not configured');
  const oAuthCallback = `https://${EXTERNAL_HOSTNAME}/in/social/oauth/twitter?user=${user}`;
  const req = {
    url: 'https://api.twitter.com/oauth/request_token',
    method: 'POST',
    data: { oauth_callback: oAuthCallback },
  };
  const { data } = await axios({
    url: req.url,
    method: req.method as 'POST',
    data: querystring.stringify(oauth.authorize(req) as any),
  });
  const payload = querystring.parse(data);
  if (!payload.oauth_callback_confirmed) throw new ValidationError('get twitter token fail');
  const {
    oauth_token: oAuthToken,
    oauth_token_secret: oAuthTokenSecret,
  } = payload;
  const url = `https://api.twitter.com/oauth/authenticate?oauth_token=${oAuthToken}&perms=read`;
  return { url, oAuthToken, oAuthTokenSecret };
}

export async function fetchTwitterUser(oAuthToken, oAuthTokenSecret, oAuthVerifier) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET) throw new ValidationError('twitter app not configured');
  const token = {
    key: oAuthToken,
    secret: oAuthTokenSecret,
  };
  const req = {
    url: 'https://api.twitter.com/oauth/access_token',
    method: 'POST',
    data: { oauth_verifier: oAuthVerifier },
  };
  const { data } = await axios({
    url: req.url,
    method: req.method as 'POST',
    data: querystring.stringify(oauth.authorize(req, token) as any),
  });
  const payload = querystring.parse(data);
  if (!payload.user_id) throw new ValidationError('twitter oauth verify fail');
  const {
    user_id: userId,
    screen_name: displayName,
    oauth_token: replyOAuthToken,
    oauth_token_secret: replyOAuthTokenSecret,
  } = payload;
  return {
    userId,
    displayName,
    oAuthToken: replyOAuthToken,
    oAuthTokenSecret: replyOAuthTokenSecret,
  };
}

export async function fetchTwitterUserByAccessToken(accessToken, secret) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET) throw new ValidationError('twitter app not configured');
  const token = {
    key: accessToken,
    secret,
  };
  const req = {
    url: 'https://api.twitter.com/1.1/account/verify_credentials.json',
    method: 'GET',
  };
  const { data } = await axios({
    url: `${req.url}?${querystring.stringify(oauth.authorize(req, token) as any)}`,
    method: req.method as 'GET',
  });
  const payload = data;
  if (!payload.id_str) throw new ValidationError('twitter oauth verify fail');
  const {
    id_str: userId,
    screen_name: displayName,
  } = payload;
  return {
    userId,
    displayName,
    oAuthToken: accessToken,
    oAuthTokenSecret: secret,
  };
}
