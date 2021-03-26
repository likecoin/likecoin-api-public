import { setNoCacheHeader } from './noCache';
import {
  getProviderJWTSecret,
  verifySecrets,
  verifyAlgorithms,
  defaultVerifySecret,
  defaultVerifyAlgorithm,
  defaultAudience,
  getToken,
  issuer,
  jwtVerify,
} from '../util/jwt';
import {
  oAuthClientCollection as oAuthClientDbRef,
} from '../util/firebase';
import { filterOAuthClientInfo } from '../util/ValidationHelper';
import { PERMISSION_GROUPS } from '../constant/jwt';

const expressjwt = require('express-jwt');
const jwt = require('jsonwebtoken');
const LRU = require('lru-cache');

const providerClientInfoCache = new LRU({ max: 128, maxAge: 10 * 60 * 1000 }); // 10 min

async function fetchProviderClientInfo(clientId, req) {
  const cachedClientInfo = providerClientInfoCache.get(clientId);
  if (cachedClientInfo) {
    try {
      const info = JSON.parse(cachedClientInfo);
      req.auth = info;
      return info.secret;
    } catch (err) {
      console.error(err);
    }
  }

  const spClient = await oAuthClientDbRef.doc(clientId).get();
  if (!spClient.exists) throw new Error('INVALID_AZP');
  const clientInfo = spClient.data();
  const { secret } = clientInfo;
  const filteredClientInfo = {
    ...filterOAuthClientInfo(clientInfo),
    clientId,
    secret,
  };
  req.auth = filteredClientInfo;
  providerClientInfoCache.set(clientId, JSON.stringify(filteredClientInfo));
  return secret;
}

export function expandScopeGroup(scope) {
  if (PERMISSION_GROUPS[scope]) {
    return PERMISSION_GROUPS[scope];
  }
  return [scope];
}

export function expandScope(scope) {
  const parsed = scope.split(':');
  if (parsed.length <= 1) return [scope];
  const [permission, scopesString] = parsed;
  const scopes = scopesString.split('.');
  // spread scope into list of scopes from root to leave
  // e.g. read:like.info => read:like, read:like.info
  const mainScope = scopes[0];
  let lastScope = `${permission}:${mainScope}`;
  const list = [permission, lastScope];
  for (let i = 1; i < scopes.length; i += 1) {
    const currentScope = `${lastScope}.${scopes[i]}`;
    list.push(currentScope);
    lastScope = currentScope;
  }
  return list;
}

function checkPermissions(inputScopes, targetScope) {
  let currentScopes = inputScopes;
  if (!currentScopes) return false;
  if (!Array.isArray(currentScopes)) currentScopes = currentScopes.split(' ');
  const expandedTargetScope = expandScope(targetScope);
  const expandedCurrentScopes = [];
  currentScopes = currentScopes.reduce((acc, s) => acc.concat(...expandScopeGroup(s)), []);
  currentScopes.forEach((s) => {
    if (!s.includes(':') && !['read', 'write', 'profile', 'email'].includes(s)) {
      expandedCurrentScopes.push(`read:${s}`);
      expandedCurrentScopes.push(`write:${s}`);
    } else {
      expandedCurrentScopes.push(s);
    }
  });
  if (expandedCurrentScopes.find(scope => expandedTargetScope.includes(scope))) {
    return true;
  }
  return false;
}

export const jwtAuth = (
  permission = 'read',
  inputSecret = defaultVerifySecret,
  {
    audience = defaultAudience,
    algorithm: inputAlgorithm = defaultVerifyAlgorithm,
  } = {},
) => async (req, res, next) => {
  setNoCacheHeader(res);
  let secret = inputSecret;
  let algorithm = inputAlgorithm;
  try {
    const token = getToken(req);
    const { payload, header } = jwt.decode(token, { complete: true });
    if (payload && payload.azp) {
      const clientSecret = await fetchProviderClientInfo(payload.azp, req);
      secret = getProviderJWTSecret(clientSecret); // eslint-disable-line no-param-reassign
      algorithm = 'HS256';
    } else if (header && header.alg && verifyAlgorithms.includes(header.alg)) {
      secret = verifySecrets[header.alg];
      algorithm = header.alg;
    }
  } catch (err) {
    // no op
  }
  expressjwt({
    secret,
    algorithms: [algorithm],
    getToken,
    audience,
    issuer,
  })(req, res, (e) => {
    if (e && e instanceof expressjwt.UnauthorizedError) {
      if (e.inner && e.inner.name === 'TokenExpiredError') {
        res.status(401).send('TOKEN_EXPIRED');
        return;
      }
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    if (!req.user
      || (permission && !req.user.permissions && !req.user.scope)
      || ((permission && !checkPermissions(req.user.permissions, permission))
        && (permission && !checkPermissions(req.user.scope, permission)))) {
      res.status(403).send('INSUFFICIENT_PERMISSION');
      return;
    }
    next(e);
  });
};

export const jwtOptionalAuth = (
  permission = 'read',
  inputSecret = defaultVerifySecret,
  {
    audience = defaultAudience,
    algorithm: inputAlgorithm = defaultVerifyAlgorithm,
  } = {},
) => async (req, res, next) => {
  setNoCacheHeader(res);
  let secret = inputSecret;
  let algorithm = inputAlgorithm;
  try {
    const token = getToken(req);
    const { payload, header } = jwt.decode(token, { complete: true });
    if (payload && payload.azp) {
      const clientSecret = await fetchProviderClientInfo(payload.azp, req);
      secret = getProviderJWTSecret(clientSecret); // eslint-disable-line no-param-reassign
      algorithm = 'HS256';
    } else if (header && header.alg && verifyAlgorithms.includes(header.alg)) {
      secret = verifySecrets[header.alg];
      algorithm = header.alg;
    }
  } catch (err) {
    // no op
  }
  expressjwt({
    credentialsRequired: false,
    secret,
    algorithms: [algorithm],
    getToken,
    audience,
    issuer,
  })(req, res, (e) => {
    if (e instanceof expressjwt.UnauthorizedError) {
      if (req.auth) {
        // throw error if token is azp token
        if (e.inner && e.inner.name === 'TokenExpiredError') {
          res.status(401).send('TOKEN_EXPIRED');
          return;
        }
        console.error(e);
        res.status(401).send('LOGIN_NEEDED');
        return;
      }
      next();
      return;
    }
    if (!req.user
      || (permission && !req.user.permissions && !req.user.scope)
      || ((permission && !checkPermissions(req.user.permissions, permission))
        && (permission && !checkPermissions(req.user.scope, permission)))) {
      if (req.auth) {
        res.status(403).send('INSUFFICIENT_PERMISSION');
        return;
      }
      req.user = undefined;
    }
    next(e);
  });
};

export const getJwtInfo = async (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded.azp) {
      const clientSecret = await fetchProviderClientInfo(decoded.azp, {});
      const secret = getProviderJWTSecret(clientSecret);
      return jwtVerify(token, secret);
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw err;
    // no op
  }
  return {};
};
