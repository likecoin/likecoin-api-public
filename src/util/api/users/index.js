import axios from 'axios';
import crypto from 'crypto';
import {
  AUTH_COOKIE_OPTION,
  BUTTON_COOKIE_OPTION,
  KNOWN_EMAIL_HOSTS,
  KICKBOX_DISPOSIBLE_API,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  configCollection,
  FieldValue,
} from '../../firebase';
import { checkAddressValid } from '../../ValidationHelper';
import { ValidationError } from '../../ValidationError';
import { jwtSign } from '../../jwt';
import {
  INTERCOM_USER_HASH_SECRET,
  INTERCOM_USER_ANDROID_HASH_SECRET,
  INTERCOM_USER_IOS_HASH_SECRET,
  CRISP_USER_HASH_SECRET,
} from '../../../../config/config';
import { verifyCosmosSignInPayload } from '../../cosmos';

const disposableDomains = require('disposable-email-domains');
const web3Utils = require('web3-utils');
const sigUtil = require('eth-sig-util');
const LRU = require('lru-cache');

const emailDomainCache = new LRU({ max: 1024, maxAge: 3600 }); // 1 hour

export const FIVE_MIN_IN_MS = 300000;

function isSafari(req) {
  return /(Version\/([0-9._]+).*Safari|\biOS\b)/.test(req.headers['user-agent']);
}

function getButtonCookieOptions(req) {
  /* mitigate safari sameSite none becomes true bug */
  return {
    ...BUTTON_COOKIE_OPTION,
    sameSite: isSafari(req) ? false : BUTTON_COOKIE_OPTION.sameSite,
  };
}

function getOldAuthCookieOptions(req) {
  /* mitigate safari sameSite none becomes true bug */
  return {
    ...AUTH_COOKIE_OPTION,
    sameSite: isSafari(req) ? false : BUTTON_COOKIE_OPTION.sameSite,
  };
}

function getAuthCookieOptions(req) {
  /* mitigate safari sameSite none becomes true bug */
  return {
    ...AUTH_COOKIE_OPTION,
    sameSite: isSafari(req) ? false : AUTH_COOKIE_OPTION.sameSite,
  };
}

export function getUserAgentIsApp(req) {
  const { 'user-agent': userAgent = '' } = req.headers;
  return (userAgent.includes('LikeCoinApp'));
}

export function getUserAgentPlatform(req) {
  const { 'user-agent': userAgent = '' } = req.headers;
  if (userAgent.includes('LikeCoinApp')) {
    if (userAgent.includes('Android')) return 'android';
    if (userAgent.includes('iOS')) return 'ios';
  }
  return 'web';
}

export function getCrispUserHash(email) {
  if (!CRISP_USER_HASH_SECRET) return undefined;
  return crypto.createHmac('sha256', CRISP_USER_HASH_SECRET)
    .update(email)
    .digest('hex');
}

export function getIntercomUserHash(user, { type = 'web' } = {}) {
  let secret = INTERCOM_USER_HASH_SECRET;
  switch (type) {
    case 'web':
      if (INTERCOM_USER_HASH_SECRET) secret = INTERCOM_USER_HASH_SECRET;
      break;
    case 'android':
      if (INTERCOM_USER_ANDROID_HASH_SECRET) secret = INTERCOM_USER_ANDROID_HASH_SECRET;
      break;
    case 'ios':
      if (INTERCOM_USER_IOS_HASH_SECRET) secret = INTERCOM_USER_IOS_HASH_SECRET;
      break;
    default: break;
  }
  if (!secret) return undefined;
  return crypto.createHmac('sha256', secret)
    .update(user)
    .digest('hex');
}

export function clearAuthCookies(req, res) {
  res.clearCookie('likecoin_auth', getAuthCookieOptions(req));
  res.clearCookie('likecoin_auth', getOldAuthCookieOptions(req));
  res.clearCookie('likecoin_button_auth', getButtonCookieOptions(req));
}

export async function setAuthCookies(req, res, { user, platform }) {
  clearAuthCookies(req, res);
  const { token, jwtid } = jwtSign({
    user,
    platform,
    permissions: ['read', 'write'],
  });
  const { token: buttonToken, jwtid: buttonJwtId } = jwtSign({
    user,
    platform,
    permissions: ['likebutton'],
  });
  res.cookie('likecoin_auth', token, getAuthCookieOptions(req));
  res.cookie('likecoin_button_auth', buttonToken, getButtonCookieOptions(req));
  await dbRef.doc(user).collection('session').doc(jwtid).create({
    lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
    lastAccessedIP: req.headers['x-real-ip'] || req.ip,
    lastAccessedTs: Date.now(),
    jwtid,
    buttonJwtId,
    ts: Date.now(),
  });
}

export function checkSignPayload(from, payload, sign) {
  const recovered = sigUtil.recoverPersonalSignature({ data: payload, sig: sign });
  if (recovered.toLowerCase() !== from.toLowerCase()) {
    throw new ValidationError('RECOVEREED_ADDRESS_NOT_MATCH');
  }

  // trims away sign message header before JSON
  const message = web3Utils.hexToUtf8(payload);
  const actualPayload = JSON.parse(message.substr(message.indexOf('{')));
  const {
    wallet,
    ts,
  } = actualPayload;

  // check address match
  if (from !== wallet || !checkAddressValid(wallet)) {
    throw new ValidationError('PAYLOAD_WALLET_NOT_MATCH');
  }

  // Check ts expire
  if (Math.abs(ts - Date.now()) > FIVE_MIN_IN_MS) {
    throw new ValidationError('PAYLOAD_EXPIRED');
  }
  return actualPayload;
}

export function checkCosmosSignPayload({
  signature, publicKey, message, inputWallet,
}) {
  const verified = verifyCosmosSignInPayload({
    signature, publicKey, message, inputWallet,
  });
  if (!verified) {
    throw new ValidationError('INVALID_SIGNATURE');
  }
  let actualPayload = {};
  try {
    const { memo } = JSON.parse(message);
    actualPayload = JSON.parse(memo.substr(memo.indexOf('{')));
  } catch (err) {
    throw new ValidationError('INVALID_PAYLOAD');
  }
  const {
    ts,
    cosmosWallet: payloadCosmosWallet,
    likeWallet: payloadLikeWallet,
  } = actualPayload;
  if (payloadLikeWallet !== inputWallet && payloadCosmosWallet !== inputWallet) {
    throw new ValidationError('PAYLOAD_WALLET_NOT_MATCH');
  }
  if (Math.abs(ts - Date.now()) > FIVE_MIN_IN_MS) {
    throw new ValidationError('PAYLOAD_EXPIRED');
  }
  return actualPayload;
}

export function userByEmailQuery(user, email) {
  return dbRef.where('email', '==', email).get().then((snapshot) => {
    snapshot.forEach((doc) => {
      const docUser = doc.id;
      if (user !== docUser) {
        throw new ValidationError('EMAIL_ALREADY_USED');
      }
    });
    return true;
  });
}

export function queryNormalizedEmailExists(user, email) {
  return dbRef.where('normalizedEmail', '==', email).get().then((snapshot) => {
    const isExists = snapshot.docs.some((doc) => {
      const docUser = doc.id;
      return (user !== docUser);
    });
    return isExists;
  });
}

export async function normalizeUserEmail(user, email) {
  if (!email) return {};
  let normalizedEmail = email.toLowerCase();
  let isEmailBlacklisted;
  const BLACK_LIST_DOMAIN = disposableDomains;
  const parts = email.split('@');
  let emailUser = parts[0];
  const domain = parts[1];
  if (BLACK_LIST_DOMAIN.includes(domain)) {
    isEmailBlacklisted = true;
  }
  if (!KNOWN_EMAIL_HOSTS.includes(domain)) {
    try {
      const domainCache = emailDomainCache.get(domain);
      if (domainCache !== undefined) {
        if (domainCache) isEmailBlacklisted = true;
      } else {
        const { data } = await axios.get(`${KICKBOX_DISPOSIBLE_API}/${domain}`);
        if (data) {
          if (data.disposable !== undefined) {
            if (data.disposable) isEmailBlacklisted = true;
            emailDomainCache.set(domain, data.disposable);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
    const blacklistDoc = await configCollection.doc('emailBlacklist').get();
    const { list: customBlackList } = blacklistDoc.data() || {};
    if (customBlackList) {
      customBlackList.forEach((keyword) => {
        if (domain.includes(keyword)) {
          isEmailBlacklisted = true;
          emailDomainCache.set(domain, true);
        }
      });
    }
  }
  const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
  /* we handle special char for all domain
    the processed string is only stored as normalizedEmail
    for anti spam/analysis purpose, not for actual sending */
  // handlt dot for all domain
  emailUser = emailUser.split('.').join('');
  // handlt plus for all domain
  [emailUser] = emailUser.split('+');
  normalizedEmail = `${emailUser.toLowerCase()}@${domain.toLowerCase()}`;
  let isEmailDuplicated;
  if (user) {
    isEmailDuplicated = await queryNormalizedEmailExists(user, normalizedEmail);
  }
  return {
    isEmailInvalid,
    isEmailBlacklisted,
    isEmailDuplicated,
    normalizedEmail,
  };
}

async function userInfoQuery({
  user,
  cosmosWallet,
  likeWallet,
  email,
  platform,
  platformUserId,
  authCoreUserId,
}) {
  const userNameQuery = dbRef.doc(user).get().then((doc) => {
    const isOldUser = doc.exists;
    let oldUserObj;
    if (isOldUser) {
      oldUserObj = doc.data();
    }
    return { isOldUser, oldUserObj };
  });
  const cosmosWalletQuery = cosmosWallet ? dbRef.where('cosmosWallet', '==', cosmosWallet).get().then((snapshot) => {
    snapshot.forEach((doc) => {
      const docUser = doc.id;
      if (user !== docUser) {
        throw new ValidationError('COSMOS_WALLET_ALREADY_EXIST');
      }
    });
    return true;
  }) : Promise.resolve();
  const likeWalletQuery = likeWallet ? dbRef.where('likeWallet', '==', likeWallet).get().then((snapshot) => {
    snapshot.forEach((doc) => {
      const docUser = doc.id;
      if (user !== docUser) {
        throw new ValidationError('LIKE_WALLET_ALREADY_EXIST');
      }
    });
    return true;
  }) : Promise.resolve();

  const emailQuery = email ? userByEmailQuery(user, email) : Promise.resolve();

  const authQuery = (platform && platformUserId) ? (
    authDbRef
      .where(`${platform}.userId`, '==', platformUserId)
      .get()
      .then((snapshot) => {
        snapshot.forEach((doc) => {
          const docUser = doc.id;
          if (user !== docUser) {
            throw new ValidationError(`${platform.toUpperCase()}_USER_DUPLICATED`);
          }
        });
        return true;
      })
  ) : Promise.resolve();

  const authCoreQuery = (authCoreUserId && platform !== 'authcore') ? (
    dbRef
      .where('authCoreUserId', '==', authCoreUserId)
      .get()
      .then((snapshot) => {
        snapshot.forEach((doc) => {
          const docUser = doc.id;
          if (user !== docUser) {
            throw new ValidationError('AUTHCORE_USER_DUPLICATED');
          }
        });
        return true;
      })
  ) : Promise.resolve();

  const [{
    isOldUser,
    oldUserObj,
  }] = await Promise.all([
    userNameQuery,
    cosmosWalletQuery,
    likeWalletQuery,
    emailQuery,
    authQuery,
    authCoreQuery,
  ]);

  return { isOldUser, oldUserObj };
}

export async function checkUserInfoUniqueness({
  user,
  cosmosWallet,
  likeWallet,
  email,
  platform,
  platformUserId,
  authCoreUserId,
}) {
  const userDoc = await dbRef.doc(user).get();
  if (userDoc.exists) throw new ValidationError('USER_ALREADY_EXIST');
  await userInfoQuery({
    user,
    cosmosWallet,
    likeWallet,
    email,
    platform,
    platformUserId,
    authCoreUserId,
  });
}

export async function checkReferrerExists(referrer) {
  const referrerRef = await dbRef.doc(referrer).get();
  if (!referrerRef.exists) return false;
  if (referrerRef.data().isBlackListed) {
    console.log(`User referrer limit: ${referrer}`);
    throw new ValidationError('REFERRER_LIMIT_EXCCEDDED');
  }
  return referrerRef.exists;
}

export async function tryToLinkOAuthLogin({
  likeCoinId,
  platform,
  platformUserId,
}) {
  // Make sure no one has linked with this platform and user ID for OAuth login
  const query = await (
    authDbRef
      .where(`${platform}.userId`, '==', platformUserId)
      .limit(1)
      .get()
  );
  if (query.docs.length > 0) return false;

  // Add or update auth doc
  const authDocRef = authDbRef.doc(likeCoinId);
  await authDocRef.set({
    [platform]: {
      userId: platformUserId,
    },
  }, { merge: true });
  return true;
}

export async function tryToUnlinkOAuthLogin({
  likeCoinId,
  platform,
}) {
  // Check if auth doc exists
  const authDocRef = authDbRef.doc(likeCoinId);
  const authDoc = await authDocRef.get();
  if (!authDoc.exists) return false;

  const data = authDoc.data();
  if (!data[platform]) return false;
  const isSole = Object.keys(data).length <= 1;
  if (isSole) {
    // Make sure user has other sign in methods before unlink
    const userDoc = await dbRef.doc(likeCoinId).get();
    const { wallet } = userDoc.data();
    if (wallet) {
      await authDocRef.delete();
    } else {
      throw new ValidationError('USER_UNLINK_SOLE_OAUTH_LOGIN');
    }
  } else {
    await authDocRef.update({
      [platform]: FieldValue.delete(),
    });
  }
  return true;
}

export * from './getPublicInfo';
