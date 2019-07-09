import crypto from 'crypto';
import base64url from 'base64url';

import { getProviderJWTSecret, jwtSignForAZP } from '../../jwt';
import {
  oAuthClientCollection as oAuthClientDbRef,
} from '../../firebase';

function signProviderSecret(clientId, secret, { user, scope }) {
  const payload = {
    user,
    scope,
  };
  return jwtSignForAZP(
    payload,
    getProviderJWTSecret(secret),
    { azp: clientId },
  );
}

export async function autoGenerateUserTokenForClient(req, platform, user) {
  const spClientQuery = oAuthClientDbRef.where('platform', '==', platform).limit(1);
  const spClientRef = await spClientQuery.get();
  const targetClient = spClientRef.docs[0];
  if (!targetClient) return {};
  const { secret, scopeWhiteList: scope } = targetClient.data();
  const { token: accessToken, jwtid } = signProviderSecret(
    targetClient.id,
    secret,
    { user, scope },
  );

  const refreshToken = base64url(crypto.randomBytes(32));
  await spClientRef.collection('users').doc(user).create({
    scope,
    accessToken: jwtid,
    refreshToken,
    lastAccessedIP: req.headers['x-real-ip'] || req.ip,
    lastAccessedTs: Date.now(),
    lastRefreshedTs: Date.now(),
    ts: Date.now(),
  }, { merge: true });

  return {
    user,
    scope,
    accessToken,
    refreshToken,
  };
}

export default autoGenerateUserTokenForClient;
