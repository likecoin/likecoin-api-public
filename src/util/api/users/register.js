import { sendVerificationEmail } from '../../ses';
import {
  PUBSUB_TOPIC_MISC,
  MIN_USER_ID_LENGTH,
  MAX_USER_ID_LENGTH,
} from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
} from '../../firebase';
import {
  handleEmailBlackList,
  checkReferrerExists,
  checkUserInfoUniqueness,
  userByEmailQuery,
} from '.';
import { tryToLinkSocialPlatform } from '../social';
import { ValidationError } from '../../ValidationError';
import { checkUserNameValid } from '../../ValidationHelper';
import { handleAvatarUploadAndGetURL } from '../../fileupload';
import publisher from '../../gcloudPub';
import {
  NEW_USER_BONUS_COOLDOWN,
} from '../../../../config/config';

const uuidv4 = require('uuid/v4');

function getBool(value = false) {
  if (typeof value === 'string') {
    return value !== 'false';
  }
  return value;
}

function getRandomPaddedDigits(length) {
  return String(Math.floor(Math.random() * (10 ** length))).padStart(length, '0');
}

export async function suggestAvailableUserName(username) {
  const RANDOM_DIGIT_LENGTH = 5;
  const MAX_SUGGEST_TRY = 5;
  let isIDAvailable = false;
  let tries = 0;
  let tryName = username.substring(0, MAX_USER_ID_LENGTH - RANDOM_DIGIT_LENGTH);
  if (tryName.length < MIN_USER_ID_LENGTH) {
    tryName = `${username}${getRandomPaddedDigits(RANDOM_DIGIT_LENGTH)}`;
  }
  while (!isIDAvailable && tries < MAX_SUGGEST_TRY) {
    const userDoc = await dbRef.doc(tryName).get(); // eslint-disable-line no-await-in-loop
    if (!userDoc.exists) {
      isIDAvailable = true;
      break;
    }
    tryName = `${username}${getRandomPaddedDigits(RANDOM_DIGIT_LENGTH)}`;
    tries += 1;
  }
  if (!isIDAvailable || !tryName || !checkUserNameValid(tryName)) {
    tryName = '';
  }
  return tryName;
}

export async function handleUserRegistration({
  payload,
  req,
  res,
  isPlatformDelegated = false,
}) {
  const {
    user,
    displayName = user,
    wallet,
    avatarSHA256,
    referrer,
    platform,
    platformUserId,
    firebaseUserId,
    isEmailVerified,
    locale = 'en',
    accessToken,
    secret,
    sourceURL,
  } = payload;
  let { email, isEmailEnabled = true } = payload;

  isEmailEnabled = getBool(isEmailEnabled);

  if (!checkUserNameValid(user)) throw new ValidationError('Invalid user name');

  if (email) {
    try {
      email = handleEmailBlackList(email);
    } catch (err) {
      if (err.message === 'DOMAIN_NOT_ALLOWED' || err.message === 'DOMAIN_NEED_EXTRA_CHECK') {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventBlockEmail',
          user,
          email,
          displayName,
          wallet,
          referrer: referrer || undefined,
          locale,
        });
      }
      throw err;
    }
  }

  const isNew = await checkUserInfoUniqueness({
    user,
    wallet,
    email,
    firebaseUserId,
    platform,
    platformUserId,
  });
  if (!isNew) throw new ValidationError('USER_ALREADY_EXIST');

  // upload avatar
  const { file } = req;
  let avatarUrl;
  if (file) {
    avatarUrl = await handleAvatarUploadAndGetURL(user, file, avatarSHA256);
  }
  let hasReferrer = false;
  if (referrer) {
    try {
      hasReferrer = await checkReferrerExists(referrer);
    } catch (err) {
      if (err.message === 'REFERRER_LIMIT_EXCCEDDED') {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventBlockReferrer',
          user,
          email,
          displayName,
          wallet,
          referrer,
          locale,
        });
      }
      throw err;
    }
  }
  const createObj = {
    displayName,
    wallet,
    isEmailEnabled,
    firebaseUserId,
    avatar: avatarUrl,
    locale,
  };

  if (hasReferrer) createObj.referrer = referrer;

  if (email) {
    createObj.email = email;
    createObj.isEmailVerified = isEmailVerified;

    // Hack for setting done to verifyEmail mission
    if (isEmailVerified) {
      await dbRef
        .doc(user)
        .collection('mission')
        .doc('verifyEmail')
        .set({ done: true }, { merge: true });
    } else {
      // Send verify email
      createObj.lastVerifyTs = Date.now();
      createObj.verificationUUID = uuidv4();

      try {
        await sendVerificationEmail(res, {
          email,
          displayName,
          verificationUUID: createObj.verificationUUID,
        }, createObj.referrer);
      } catch (err) {
        console.error(err);
        // Do nothing
      }
    }
  }

  if (isPlatformDelegated) {
    createObj.delegatedPlatform = platform;
    createObj.isPlatformDelegated = true;
  }

  const timestampObj = { timestamp: Date.now() };
  if (NEW_USER_BONUS_COOLDOWN) {
    timestampObj.bonusCooldown = Date.now() + NEW_USER_BONUS_COOLDOWN;
  }
  Object.assign(createObj, timestampObj);

  Object.keys(createObj).forEach((key) => {
    if (createObj[key] === undefined) {
      delete createObj[key];
    }
  });

  await dbRef.doc(user).create(createObj);
  if (hasReferrer) {
    await dbRef.doc(referrer).collection('referrals').doc(user).create({
      ...timestampObj,
      isEmailVerified,
    });
  }

  if (platformUserId) {
    const doc = {
      [platform]: {
        userId: platformUserId,
      },
    };
    if (firebaseUserId) {
      doc.firebase = { userId: firebaseUserId };
    }
    await authDbRef.doc(user).create(doc);
  }

  const socialPayload = await tryToLinkSocialPlatform(user, platform, { accessToken, secret });

  return {
    userPayload: {
      user,
      email: email || undefined,
      displayName,
      wallet,
      avatar: avatarUrl,
      referrer: referrer || undefined,
      locale,
      registerTime: createObj.timestamp,
      registerMethod: platform,
      sourceURL,
    },
    socialPayload,
  };
}

export async function checkUserEmailUsable(user, email) {
  try {
    const outputEmail = handleEmailBlackList(email);
    await userByEmailQuery(user, outputEmail);
    return true;
  } catch (err) {
    return false;
  }
}
