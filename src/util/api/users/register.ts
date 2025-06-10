import uuidv4 from 'uuid/v4';

import { sendVerificationEmail } from '../../sendgrid';
import {
  PUBSUB_TOPIC_MISC,
  MIN_USER_ID_LENGTH,
  MAX_USER_ID_LENGTH,
  IS_TESTNET,
  EXTERNAL_HOSTNAME,
} from '../../../constant';
import {
  userCollection as dbRef,
} from '../../firebase';
import {
  normalizeUserEmail,
  checkReferrerExists,
  checkUserInfoUniqueness,
  getUserAgentIsApp,
} from '.';
import { ValidationError } from '../../ValidationError';
import { checkUserNameValid, checkCosmosAddressValid, checkAddressValid } from '../../ValidationHelper';
import {
  handleAvatarUploadAndGetURL,
  handleAvatarLinkAndGetURL,
} from '../../fileupload';
import publisher from '../../gcloudPub';
import {
  NEW_USER_BONUS_COOLDOWN,
} from '../../../../config/config';

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
    description,
    cosmosWallet,
    likeWallet,
    evmWallet,
    avatarSHA256,
    avatarURL: avatarURLInput,
    referrer,
    platform,
    authCoreUserId,
    isEmailVerified = false,
    isPhoneVerified,
    locale = 'en',
    email,
    phone,
    utmSource,
  } = payload;
  let { sourceURL, isEmailEnabled = true } = payload;

  isEmailEnabled = getBool(isEmailEnabled);
  if (getUserAgentIsApp(req) && !sourceURL) {
    sourceURL = `https://${EXTERNAL_HOSTNAME}/in/getapp`;
  }

  if (!checkUserNameValid(user)) throw new ValidationError('INVALID_USER_ID');
  if (!cosmosWallet && !likeWallet && !evmWallet) {
    throw new ValidationError('WALLET_NOT_PROVIDED');
  }
  if (cosmosWallet && !checkCosmosAddressValid(cosmosWallet, 'cosmos')) {
    throw new ValidationError('INVALID_COSMOS_WALLET');
  }
  if (likeWallet && !checkCosmosAddressValid(likeWallet, 'like')) {
    throw new ValidationError('INVALID_LIKE_WALLET');
  }
  if (evmWallet && !checkAddressValid(evmWallet)) {
    throw new ValidationError('INVALID_EVM_WALLET');
  }

  await checkUserInfoUniqueness({
    user,
    cosmosWallet,
    likeWallet,
    evmWallet,
    email,
    platform,
    authCoreUserId,
  });

  // upload avatar
  const { file } = req;
  let avatarURL;
  let avatarHash;
  try {
    if (file) {
      ({
        url: avatarURL,
        hash: avatarHash,
      } = await handleAvatarUploadAndGetURL(user, file, avatarSHA256));
    } else if (avatarURLInput) {
      avatarURL = await handleAvatarLinkAndGetURL(user, avatarURLInput);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Avatar file handling error:');
    // eslint-disable-next-line no-console
    console.error(err);
  }
  let hasReferrer = false;
  if (referrer) {
    try {
      hasReferrer = await checkReferrerExists(referrer);
    } catch (err) {
      if ((err as Error).message === 'REFERRER_LIMIT_EXCCEDDED') {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventBlockReferrer',
          user,
          email,
          phone,
          cosmosWallet,
          likeWallet,
          evmWallet,
          displayName,
          referrer,
          locale,
        });
      }
      throw err;
    }
  }
  const createObj: any = {
    displayName,
    cosmosWallet,
    authCoreUserId,
    isEmailEnabled,
    locale,
  };

  if (avatarURL) {
    createObj.avatar = avatarURL;
    if (avatarHash) createObj.avatarHash = avatarHash;
  }
  if (likeWallet) createObj.likeWallet = likeWallet;
  if (evmWallet) createObj.evmWallet = evmWallet;
  if (hasReferrer) createObj.referrer = referrer;
  if (description) createObj.description = description;

  if (email) {
    createObj.email = email;
    createObj.isEmailVerified = isEmailVerified;
    const {
      normalizedEmail,
      isEmailInvalid,
      isEmailBlacklisted,
      isEmailDuplicated,
    } = await normalizeUserEmail(user, email);
    if (normalizedEmail) createObj.normalizedEmail = normalizedEmail;
    if (isEmailInvalid) createObj.isEmailInvalid = isEmailInvalid;
    if (isEmailBlacklisted !== undefined) {
      if (!IS_TESTNET && isEmailBlacklisted && platform === 'authcore') {
        throw new ValidationError('EMAIL_DOMAIN_LIST');
      }
      createObj.isEmailBlacklisted = isEmailBlacklisted;
    }
    if (isEmailDuplicated !== undefined) {
      if (!IS_TESTNET && isEmailDuplicated && platform === 'authcore') {
        throw new ValidationError('EMAIL_ALREADY_USED');
      }
      createObj.isEmailDuplicated = isEmailDuplicated;
    }

    // TODO: trigger verify email via authcore?
    if (!(isEmailVerified || isEmailBlacklisted || isEmailInvalid)) {
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
        // eslint-disable-next-line no-console
        console.error(err);
        // Do nothing
      }
    }
  }

  if (phone) {
    createObj.phone = phone;
    createObj.isPhoneVerified = isPhoneVerified;
  }

  if (isPlatformDelegated) {
    createObj.delegatedPlatform = platform;
    createObj.isPlatformDelegated = false;
  }

  const timestampObj: any = { timestamp: Date.now() };
  if (NEW_USER_BONUS_COOLDOWN) {
    timestampObj.bonusCooldown = Date.now() + NEW_USER_BONUS_COOLDOWN;
  }
  Object.assign(createObj, timestampObj);

  switch (platform) {
    case 'matters': {
      createObj.mediaChannels = [platform];
      break;
    }
    default:
      break;
  }

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

  return {
    userPayload: {
      user,
      email: email || undefined,
      normalizedEmail: createObj.normalizedEmail || undefined,
      phone: phone || undefined,
      isPhoneVerified: createObj.isPhoneVerified || false,
      displayName,
      description,
      cosmosWallet,
      likeWallet,
      evmWallet,
      avatar: avatarURL,
      referrer: referrer || undefined,
      locale,
      isEmailVerified: createObj.isEmailVerified || false,
      isEmailBlacklisted: createObj.isEmailBlacklisted || undefined,
      isEmailDuplicated: createObj.isEmailDuplicated || undefined,
      registerTime: createObj.timestamp,
      registerMethod: platform,
      sourceURL,
      utmSource,
      mediaChannels: createObj.mediaChannels,
    },
  };
}
