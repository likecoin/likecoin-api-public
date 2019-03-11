import { setNoCacheHeader } from './noCache';
import {
  getProviderJWTSecret,
  publicKey as verifySecret,
  defaultAudience,
  getToken,
  issuer,
} from '../util/jwt';
import {
  oAuthClientCollection as oAuthClientDbRef,
} from '../util/firebase';

const expressjwt = require('express-jwt');
const jwt = require('jsonwebtoken');

async function fetchProviderClientSecret(clientId) {
  const spClient = await oAuthClientDbRef.doc(clientId).get();
  if (!spClient.exists) throw new Error('INVALID_AZP');
  const {
    secret,
  } = spClient.data();
  return secret;
}

function checkPermissions(inputScopes, target) {
  let scopes = inputScopes;
  if (!scopes) return false;
  if (!Array.isArray(scopes)) scopes = scopes.split(' ');
  let targets = target.split(':');
  if (targets.length > 1) {
    const permission = targets[0];
    const subScopes = targets[1].split('.');
    let lastScope = `${permission}:${subScopes[0]}`;
    const list = [permission, lastScope];
    for (let i = 1; i < subScopes.length; i += 1) {
      const currentScope = `${lastScope}.${subScopes[i]}`;
      list.push(currentScope);
      lastScope = currentScope;
    }
    targets = list;
  }
  if (scopes.find(scope => targets.includes(scope))) return true;
  return false;
}

export const jwtAuth = (
  permission = 'read',
  secret = verifySecret,
  { audience = defaultAudience } = {},
) => async (req, res, next) => {
  setNoCacheHeader(res);
  try {
    const token = getToken(req);
    const decoded = jwt.decode(token);
    if (decoded.azp) {
      const clientSecret = await fetchProviderClientSecret(decoded.azp);
      secret = getProviderJWTSecret(clientSecret); // eslint-disable-line no-param-reassign
    }
  } catch (err) {
    // no op
  }
  expressjwt({
    secret,
    getToken,
    audience,
    issuer,
  })(req, res, (e) => {
    if (e instanceof expressjwt.UnauthorizedError) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    if (!req.user
      || (permission && !req.user.permissions && !req.user.scope)
      || ((permission && !checkPermissions(req.user.permissions, permission))
        && (permission && !checkPermissions(req.user.scope, permission)))) {
      res.status(401).send('INVALID_GRANT');
      return;
    }
    next(e);
  });
};

export const jwtOptionalAuth = (
  permission = 'read',
  secret = verifySecret,
  { audience = defaultAudience } = {},
) => async (req, res, next) => {
  setNoCacheHeader(res);
  try {
    const token = getToken(req);
    const decoded = jwt.decode(token);
    if (decoded.azp) {
      const clientSecret = await fetchProviderClientSecret(decoded.azp);
      secret = getProviderJWTSecret(clientSecret); // eslint-disable-line no-param-reassign
    }
  } catch (err) {
    // no op
  }
  expressjwt({
    credentialsRequired: false,
    secret,
    getToken,
    audience,
    issuer,
  })(req, res, (e) => {
    if (e instanceof expressjwt.UnauthorizedError) {
      next();
      return;
    }
    if (!req.user
      || (permission && !req.user.permissions && !req.user.scope)
      || ((permission && !checkPermissions(req.user.permissions, permission))
        && (permission && !checkPermissions(req.user.scope, permission)))) {
      req.user = undefined;
    }
    next(e);
  });
};
