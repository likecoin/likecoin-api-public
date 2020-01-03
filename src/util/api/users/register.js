import { sendVerificationEmail } from '../../ses';
import {
  PUBSUB_TOPIC_MISC,
  MIN_USER_ID_LENGTH,
  MAX_USER_ID_LENGTH,
} from '../../../constant';
import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  db,
} from '../../firebase';
import {
  getAuthCoreUserOAuthFactors,
} from '../../authcore';
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

export async function suggestAvailableUserName(username = '') {
  const RANDOM_DIGIT_LENGTH = 5;
  const MAX_SUGGEST_TRY = 5;
  let isIDAvailable = false;
  let tries = 0;
  let tryName = username.substring(0, MAX_USER_ID_LENGTH - RANDOM_DIGIT_LENGTH).toLowerCase();
  if (tryName.length < MIN_USER_ID_LENGTH) {
    tryName = `${tryName}${getRandomPaddedDigits(RANDOM_DIGIT_LENGTH)}`;
  }
  while (!isIDAvailable && tries < MAX_SUGGEST_TRY) {
    const userDoc = await dbRef.doc(tryName).get(); // eslint-disable-line no-await-in-loop
    if (!userDoc.exists) {
      isIDAvailable = true;
      break;
    }
    if (tryName.length > MAX_USER_ID_LENGTH) {
      tryName = tryName.substring(0, MAX_USER_ID_LENGTH - RANDOM_DIGIT_LENGTH);
    }
    tryName = `${tryName}${getRandomPaddedDigits(RANDOM_DIGIT_LENGTH)}`;
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
    cosmosWallet,
    avatarSHA256,
    referrer,
    platform,
    platformUserId,
    authCoreUserId,
    isEmailVerified,
    locale = 'en',
    accessToken,
    secret,
    sourceURL,
    email,
  } = payload;
  let { isEmailEnabled = true } = payload;

  isEmailEnabled = getBool(isEmailEnabled);

  if (!checkUserNameValid(user)) throw new ValidationError('Invalid user name');

  // if (email && platform !== 'authcore') { // TODO: temp trust authcore source
  //   try {
  //     email = handleEmailBlackList(email);
  //   } catch (err) {
  //     if (err.message === 'DOMAIN_NOT_ALLOWED' || err.message === 'DOMAIN_NEED_EXTRA_CHECK') {
  //       publisher.publish(PUBSUB_TOPIC_MISC, req, {
  //         logType: 'eventBlockEmail',
  //         user,
  //         email,
  //         cosmosWallet,
  //         displayName,
  //         referrer: referrer || undefined,
  //         locale,
  //       });
  //     }
  //     throw err;
  //   }
  // }

  await checkUserInfoUniqueness({
    user,
    cosmosWallet,
    email,
    platform,
    platformUserId,
    authCoreUserId,
  });

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
          cosmosWallet,
          displayName,
          referrer,
          locale,
        });
      }
      throw err;
    }
  }
  const createObj = {
    displayName,
    cosmosWallet,
    authCoreUserId,
    isEmailEnabled,
    avatar: avatarUrl,
    locale,
  };

  if (hasReferrer) createObj.referrer = referrer;

  if (email) {
    createObj.email = email;
    createObj.isEmailVerified = isEmailVerified;

    // TODO: trigger verify email via authcore?
    if (!isEmailVerified) {
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
    createObj.isPlatformDelegated = false;
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
  const batch = db.batch();
  batch.create(dbRef.doc(user), createObj);
  if (hasReferrer) {
    await dbRef.doc(referrer).collection('referrals').doc(user).create({
      ...timestampObj,
      isEmailVerified,
    });
  }

  if (authCoreUserId || (platform && platformUserId)) {
    const doc = {};
    if (authCoreUserId) {
      doc.authcore = { userId: authCoreUserId };
      if (platform === 'authcore' && accessToken) {
        try {
          const oAuthFactors = await getAuthCoreUserOAuthFactors(accessToken);
          if (oAuthFactors && oAuthFactors.length) {
            oAuthFactors.forEach((f) => {
              doc[f.service] = { userId: f.userId };
            });
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
    if (platform && platformUserId) {
      doc[platform] = {
        userId: platformUserId,
      };
    }
    batch.create(authDbRef.doc(user), doc);
  }
  await batch.commit();

  // TODO: fetch social info in authcore after confirm
  const socialPayload = await tryToLinkSocialPlatform(user, platform, { accessToken, secret });

  return {
    userPayload: {
      user,
      email: email || undefined,
      displayName,
      cosmosWallet,
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
