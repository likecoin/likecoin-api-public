import crypto from 'crypto';
import base64url from 'base64url';

import { getProviderJWTSecret, jwtSignForAZP } from '../../jwt';
import {
  admin,
  db,
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
  const spClientSnapshot = await spClientQuery.get();
  const targetClient = spClientSnapshot.docs[0];
  if (!targetClient) return {};
  const { secret, scopeWhiteList: scope } = targetClient.data();
  const { token: accessToken, jwtid } = signProviderSecret(
    targetClient.id,
    secret,
    { user, scope },
  );

  const spUserRef = targetClient.ref.collection('users').doc(user);
  const currentRefreshToken = await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const spUserDoc = await spUserRef.get();
    const {
      ts = Date.now(),
      refreshToken = base64url(crypto.randomBytes(32)),
    } = spUserDoc.data() || {};
    await t.set(spUserRef, {
      scope,
      accessToken: jwtid,
      refreshToken,
      lastAccessedIP: req.headers['x-real-ip'] || req.ip,
      lastAccessedTs: Date.now(),
      lastRefreshedTs: Date.now(),
      ts,
    }, { merge: true });
    return refreshToken;
  });

  return {
    user,
    scope,
    jwtid,
    accessToken,
    refreshToken: currentRefreshToken,
  };
}

export default autoGenerateUserTokenForClient;
