import crypto from 'crypto';
import fs from 'fs';
import jwt, { JwtPayload } from 'jsonwebtoken';
import uuidv4 from 'uuid/v4';
import { TEST_MODE, EXTERNAL_HOSTNAME } from '../constant';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../../config/config');

const { PROVIDER_JWT_COMMON_SECRET } = config;

export const defaultAudience = EXTERNAL_HOSTNAME;
export const issuer = EXTERNAL_HOSTNAME;

const signAlgorithms: string[] = [];
const signSecrets: any = {};
const internalVerifyAlgorithms: string[] = [];
const internalVerifySecrets: any = {};
let internalDefaultSignAlgorithm;
let internalDefaultVerifyAlgorithm;
let authCoreSignSecret;
let authCoreVerifySecret;

const publicCertPath = config.JWT_PUBLIC_CERT_PATH;
const secretCertPath = config.JWT_PRIVATE_KEY_PATH;
const publicECDSACertPath = config.ECDSA_JWT_PUBLIC_CERT_PATH;
const secretECDSACertPath = config.ECDSA_JWT_PRIVATE_KEY_PATH;
const authCorePublicCertPath = config.AUTHCORE_PUBLIC_CERT_PATH;
const authCoreSecretCertPath = config.AUTHCORE_PRIVATE_KEY_PATH;
const authCoreServiceAccountIss = `serviceaccount:${config.AUTHCORE_SERVICE_ACCOUNT_ID}`;

if (publicECDSACertPath) {
  try {
    const es256verify = fs.readFileSync(publicECDSACertPath);
    if (es256verify) {
      internalVerifyAlgorithms.push('ES256');
      internalVerifySecrets.ES256 = es256verify;
      if (!internalDefaultVerifyAlgorithm) internalDefaultVerifyAlgorithm = 'ES256';
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('ECDSA cert not exist for jwt');
  }
}
if (secretECDSACertPath) {
  try {
    const es256secret = fs.readFileSync(secretECDSACertPath);
    if (es256secret) {
      signAlgorithms.push('ES256');
      signSecrets.ES256 = es256secret;
      if (!internalDefaultSignAlgorithm) internalDefaultSignAlgorithm = 'ES256';
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('ECDSA sign key not exist for jwt');
  }
}
if (publicCertPath) {
  try {
    const rs256verify = fs.readFileSync(publicCertPath);
    if (rs256verify) {
      internalVerifyAlgorithms.push('RS256');
      internalVerifySecrets.RS256 = rs256verify;
      if (!internalDefaultVerifyAlgorithm) internalDefaultVerifyAlgorithm = 'RS256';
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('RSA cert not exist for jwt');
  }
}
if (secretCertPath) {
  try {
    const rs256Secret = fs.readFileSync(secretCertPath);
    if (rs256Secret) {
      signAlgorithms.push('RS256');
      signSecrets.RS256 = rs256Secret;
      if (!internalDefaultSignAlgorithm) internalDefaultSignAlgorithm = 'RS256';
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('RSA sign key not exist for jwt');
  }
}
if (authCorePublicCertPath) {
  try {
    authCoreVerifySecret = fs.readFileSync(authCorePublicCertPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('auth core cert not exist for jwt');
  }
}

if (authCoreSecretCertPath) {
  try {
    authCoreSignSecret = fs.readFileSync(authCoreSecretCertPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('auth core cert not exist for jwt');
  }
}

if (!signAlgorithms.length || !internalVerifyAlgorithms.length) {
  const hs256Secret = TEST_MODE ? 'likecoin' : crypto.randomBytes(64).toString('hex').slice(0, 64);
  if (!signAlgorithms.length) {
    signAlgorithms.push('HS256');
    signSecrets.HS256 = hs256Secret;
    if (!internalDefaultSignAlgorithm) internalDefaultSignAlgorithm = 'HS256';
  }
  if (!internalVerifyAlgorithms.length) {
    internalVerifyAlgorithms.push('HS256');
    internalVerifySecrets.HS256 = hs256Secret;
    if (!internalDefaultVerifyAlgorithm) internalDefaultVerifyAlgorithm = 'HS256';
  }
}

export const verifySecrets = internalVerifySecrets;
export const verifyAlgorithms = internalVerifyAlgorithms;
export const defaultSignAlgorithm = internalDefaultSignAlgorithm;
export const defaultSignSecret = signSecrets[internalDefaultSignAlgorithm];
export const defaultVerifyAlgorithm = internalDefaultVerifyAlgorithm;
export const defaultVerifySecret = internalVerifySecrets[internalDefaultVerifyAlgorithm];

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
  secret = defaultVerifySecret,
  { ignoreExpiration = false, audience = defaultAudience } = {},
) => {
  const opt = { audience, issuer };
  return jwt.verify(token, secret, { ...opt, ignoreExpiration });
};

const internalSign = (
  payload,
  secret,
  opt: any = {},
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
) => internalSign(
  payload,
  defaultSignSecret,
  { algorithm: defaultSignAlgorithm, audience, expiresIn },
);

export const jwtSignForAZP = (
  payload,
  secret,
  { audience = defaultAudience, expiresIn = '1h', azp }: {
    audience?: string; expiresIn?: string; azp?: string;
  } = {},
) => {
  const opt: any = { algorithm: 'HS256', audience };
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

export const authCoreJwtVerify = (token) => {
  if (TEST_MODE && !authCorePublicCertPath && !authCoreVerifySecret) {
    return jwt.decode(
      token,
    ) as JwtPayload;
  }
  return jwt.verify(
    token,
    authCoreVerifySecret,
    { algorithms: ['ES256'] },
  ) as JwtPayload;
};
