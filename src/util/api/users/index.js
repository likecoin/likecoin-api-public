import crypto from 'crypto';
import {
  AUTH_COOKIE_OPTION,
  IS_TESTNET,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  FieldValue,
} from '../../firebase';
import { checkAddressValid } from '../../ValidationHelper';
import { ValidationError } from '../../ValidationError';
import { getEmailBlacklist, getEmailNoDot } from '../../../poller/email';
import { jwtSign } from '../../jwt';
import {
  INTERCOM_USER_HASH_SECRET,
} from '../../../../config/config';

const disposableDomains = require('disposable-email-domains');
const web3Utils = require('web3-utils');
const sigUtil = require('eth-sig-util');

export const FIVE_MIN_IN_MS = 300000;

function isSafari(req) {
  return /(Version\/([0-9._]+).*Safari|\biOS\b)/.test(req.headers['user-agent']);
}

function getAuthCookieOptions(req) {
  /* mitigate safari sameSite none becomes true bug */
  return { ...AUTH_COOKIE_OPTION, sameSite: isSafari(req) ? false : 'none' };
}

export function getIntercomUserHash(user) {
  if (!INTERCOM_USER_HASH_SECRET) return undefined;
  return crypto.createHmac('sha256', INTERCOM_USER_HASH_SECRET)
    .update(user)
    .digest('hex');
}

export async function setAuthCookies(req, res, { user, wallet }) {
  const payload = {
    user,
    wallet,
    permissions: ['read', 'write', 'like'],
  };
  const { token, jwtid } = jwtSign(payload);
  res.cookie('likecoin_auth', token, getAuthCookieOptions(req));
  await dbRef.doc(user).collection('session').doc(jwtid).create({
    lastAccessedUserAgent: req.headers['user-agent'] || 'unknown',
    lastAccessedIP: req.headers['x-real-ip'] || req.ip,
    lastAccessedTs: Date.now(),
    ts: Date.now(),
  });
}

export async function clearAuthCookies(req, res) {
  res.clearCookie('likecoin_auth', getAuthCookieOptions(req));
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

export function handleEmailBlackList(emailInput) {
  if ((process.env.CI || !IS_TESTNET) && !(W3C_EMAIL_REGEX.test(emailInput))) throw new ValidationError('invalid email');
  let email = emailInput.toLowerCase();
  const customBlackList = getEmailBlacklist();
  const BLACK_LIST_DOMAIN = disposableDomains.concat(customBlackList);
  const parts = email.split('@');
  if (BLACK_LIST_DOMAIN.includes(parts[1])) {
    throw new ValidationError('DOMAIN_NOT_ALLOWED');
  }
  customBlackList.forEach((keyword) => {
    if (parts[1].includes(keyword)) {
      throw new ValidationError('DOMAIN_NEED_EXTRA_CHECK');
    }
  });
  if (getEmailNoDot().includes(parts[1])) {
    email = `${parts[0].split('.').join('')}@${parts[1]}`;
  }
  return email;
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

async function userInfoQuery({
  user,
  cosmosWallet,
  email,
  platform,
  platformUserId,
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

  const emailQuery = email ? userByEmailQuery(user, email) : Promise.resolve();

  const authQuery = platform && platformUserId ? (
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

  const [{
    isOldUser,
    oldUserObj,
  }] = await Promise.all([
    userNameQuery,
    cosmosWalletQuery,
    emailQuery,
    authQuery,
  ]);

  return { isOldUser, oldUserObj };
}

export async function checkUserInfoUniqueness({
  user,
  cosmosWallet,
  email,
  platform,
  platformUserId,
}) {
  const userDoc = await dbRef.doc(user).get();
  if (userDoc.exists) throw new ValidationError('USER_ALREADY_EXIST');
  await userInfoQuery({
    user,
    cosmosWallet,
    email,
    platform,
    platformUserId,
  });
}

export async function checkReferrerExists(referrer) {
  const referrerRef = await dbRef.doc(referrer).get();
  if (!referrerRef.exists) return false;
  if (referrerRef.data().isBlackListed) {
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
