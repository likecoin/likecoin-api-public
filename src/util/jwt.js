import { TEST_MODE, EXTERNAL_HOSTNAME } from '../constant';
import {
  PROVIDER_JWT_COMMON_SECRET,
} from '../../config/config';

const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const uuidv4 = require('uuid/v4');
const config = require('../../config/config');

export const defaultAudience = EXTERNAL_HOSTNAME;
export const issuer = EXTERNAL_HOSTNAME;

let signAlgo = 'RS256';
let verifyAlgo = 'RS256';
let signSecret;
let verifySecret;
let authCoreSignSecret;
let authCoreVerifySecret;

const publicCertPath = config.JWT_PUBLIC_CERT_PATH;
const secretCertPath = config.JWT_PRIVATE_KEY_PATH;
const authCorePublicCertPath = config.AUTHCORE_PUBLIC_CERT_PATH;
const authCoreSecretCertPath = config.AUTHCORE_PRIVATE_KEY_PATH;
const authCoreServiceAccountIss = `serviceaccount:${config.AUTHCORE_SERVICE_ACCOUNT_ID}`;
if (publicCertPath) {
  try {
    verifySecret = fs.readFileSync(publicCertPath);
  } catch (err) {
    console.error(err);
    console.error('RSA cert not exist for jwt');
  }
}
if (secretCertPath) {
  try {
    signSecret = fs.readFileSync(secretCertPath);
  } catch (err) {
    console.error(err);
    console.error('RSA sign key not exist for jwt');
  }
}

if (authCorePublicCertPath) {
  try {
    authCoreVerifySecret = fs.readFileSync(authCorePublicCertPath);
  } catch (err) {
    console.error(err);
    console.error('auth core cert not exist for jwt');
  }
}

if (authCoreSecretCertPath) {
  try {
    authCoreSignSecret = fs.readFileSync(authCoreSecretCertPath);
  } catch (err) {
    console.error(err);
    console.error('auth core cert not exist for jwt');
  }
}

if (!signSecret || !verifySecret) {
  const secret = TEST_MODE ? 'likecoin' : crypto.randomBytes(64).toString('hex').slice(0, 64);
  if (!signSecret) {
    signSecret = secret;
    signAlgo = 'HS256';
  }
  if (!verifySecret) {
    verifySecret = secret;
    verifyAlgo = 'HS256';
  }
}

export const publicKey = verifySecret;
export const signAlgorithm = signAlgo;
export const verifyAlgorithm = verifyAlgo;

export function getProviderJWTSecret(clientSecret) {
  const hash = crypto.createHmac('sha256', PROVIDER_JWT_COMMON_SECRET)
    .update(clientSecret)
    .digest('hex');
  return hash;
}

export function getToken(req) {
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.cookies) {
    if (req.cookies.likecoin_auth) {
      return req.cookies.likecoin_auth;
    }
    if (req.cookies.likecoin_button_auth) {
      return req.cookies.likecoin_button_auth;
    }
  }
  if (req.query && req.query.access_token) {
    return req.query.access_token;
  }
  return '';
}

export const jwtVerify = (
  token,
  secret = verifySecret,
  { ignoreExpiration, audience = defaultAudience } = {},
) => {
  const opt = { audience, issuer };
  return jwt.verify(token, secret, { ...opt, ignoreExpiration });
};

const internalSign = (
  payload,
  secret,
  opt = {},
) => {
  const options = opt;
  const jwtid = uuidv4();
  options.jwtid = jwtid;
  options.issuer = issuer;
  options.mutatePayload = true;
  const result = { ...payload };
  const token = jwt.sign(result, secret, options);
  return {
    token,
    jwtid,
    exp: result.exp,
  };
};

export const jwtSign = (
  payload,
  { audience = defaultAudience, expiresIn = '30d' } = {},
) => internalSign(payload, signSecret, { algorithm: signAlgorithm, audience, expiresIn });

export const jwtSignForAZP = (
  payload,
  secret,
  { audience = defaultAudience, expiresIn = '1h', azp } = {},
) => {
  const opt = { algorithm: 'HS256', audience };
  if (expiresIn) opt.expiresIn = expiresIn;
  return internalSign({ ...payload, azp }, secret, opt);
};

export const authCoreJwtSignToken = () => {
  const token = jwt.sign({}, authCoreSignSecret, {
    algorithm: 'ES256',
    issuer: authCoreServiceAccountIss,
    expiresIn: 60,
  });
  return token;
};

export const authCoreJwtVerify = token => jwt.verify(
  token,
  authCoreVerifySecret,
  { algorithm: 'ES256' },
);
