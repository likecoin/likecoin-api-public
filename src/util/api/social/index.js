import parse from 'url-parse';
import { fetchFacebookUser } from '../../oauth/facebook';
import { fetchTwitterUser, fetchTwitterUserByAccessToken } from '../../oauth/twitter';
import { fetchMattersUser } from '../../oauth/matters';
import { tryToLinkOAuthLogin } from '../users';
import { ValidationError } from '../../ValidationError';
import { IS_LOGIN_SOCIAL, W3C_EMAIL_REGEX } from '../../../constant';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../firebase';

const hasHttp = link => /https?:\/\//.test(link);
export const getUrlWithPrefix = link => (hasHttp(link) ? link : `https://${link}`);

export const isValidSocialLink = (link) => {
  if (link.length >= 2048) return false;
  let isValid = W3C_EMAIL_REGEX.test(link);
  if (!isValid) {
    try {
      let url = getUrlWithPrefix(link);
      if (process.client) {
        url = new URL(getUrlWithPrefix(link));
        isValid = true;
      } else {
        const parsedLink = parse(url);
        if (parsedLink.protocol && parsedLink.host) isValid = true;
      }
    } catch (err) {
      // skip
    }
  }
  return isValid;
};

export async function checkPlatformAlreadyLinked(user, platform) {
  const doc = await dbRef.doc(user).collection('social').doc(platform).get();
  const data = doc.data();
  return data && data.isLinked && (!IS_LOGIN_SOCIAL.has(platform) || data.isLogin);
}

export async function socialLinkFacebook(user, accessToken, tryToOAuth = true) {
  const {
    displayName,
    link = '', // TODO: handle url is empty in frontend
    userId,
    appId,
    pages = [],
  } = await fetchFacebookUser(accessToken);

  if (tryToOAuth) {
    const success = await tryToLinkOAuthLogin({
      likeCoinId: user,
      platform: 'facebook',
      platformUserId: userId,
    });

    if (!success) throw new ValidationError('FACEBOOK_LINK_ERROR');
  }

  await dbRef.doc(user).collection('social').doc('facebook').set({
    displayName,
    userId,
    appId,
    url: link,
    userLink: link,
    pages,
    isLinked: true,
    isLogin: true,
    ts: Date.now(),
  }, { merge: true });
  return {
    displayName,
    link,
    userId,
    appId,
    pages,
  };
}

export async function socialLinkTwitter(
  user,
  { token, secret, oAuthVerifier },
  isAccessToken = false,
  tryToOAuth = true,
) {
  const {
    userId,
    displayName,
    oAuthToken,
    oAuthTokenSecret,
  } = isAccessToken
    ? await fetchTwitterUserByAccessToken(token, secret)
    : await fetchTwitterUser(token, secret, oAuthVerifier);

  if (tryToOAuth) {
    const success = await tryToLinkOAuthLogin({
      likeCoinId: user,
      platform: 'twitter',
      platformUserId: userId,
    });

    if (!success) throw new ValidationError('TWITTER_LINK_ERROR');
  }

  const url = `https://twitter.com/intent/user?user_id=${userId}`;
  await dbRef.doc(user).collection('social').doc('twitter').set({
    displayName,
    userId,
    url,
    oAuthToken: FieldValue.delete(),
    oAuthTokenSecret: FieldValue.delete(),
    isLinked: true,
    isLogin: true,
    ts: Date.now(),
  }, { merge: true });
  return {
    userId,
    displayName,
    url,
    oAuthToken,
    oAuthTokenSecret,
  };
}

export async function socialLinkMatters(
  user,
  {
    accessToken: inputAccessToken = '',
    code,
    refreshToken: inputRefreshToken = '',
  },
) {
  const {
    userId,
    displayName,
    fullName,
    url,
    imageUrl,
    refreshToken = inputRefreshToken,
    // accessToken = inputAccessToken,
  } = await fetchMattersUser({ accessToken: inputAccessToken, code });
  await dbRef.doc(user).collection('social').doc('matters').set({
    accessToken: FieldValue.delete(),
    refreshToken,
    userId,
    displayName,
    fullName,
    url,
    imageUrl,
    isLinked: true,
    isLogin: true,
    ts: Date.now(),
  }, { merge: true });

  /* No need to update matter oauth for now ? */
  // await updateMattersUserInfo({
  //   userId,
  //   likerId: user,
  //   accessToken,
  // });

  return {
    userId,
    displayName,
    fullName,
    url,
    imageUrl,
  };
}

export async function tryToLinkSocialPlatform(
  user,
  platform,
  { accessToken, secret, refreshToken },
) {
  try {
    if (await checkPlatformAlreadyLinked(user, platform)) return null;

    let platformPayload;

    switch (platform) {
      case 'facebook': {
        const {
          displayName: facebookName,
          userId: facebookID,
          appId: facebookAppId,
          link: facebookURL,
        } = await socialLinkFacebook(user, accessToken, false);
        platformPayload = {
          facebookName,
          facebookID,
          facebookAppId,
          facebookURL,
        };
        break;
      }
      case 'twitter': {
        const {
          displayName: twiiterUserName,
          userId: twitterID,
          url: twitterURL,
        } = await socialLinkTwitter(user, { token: accessToken, secret }, true, false);
        platformPayload = {
          twiiterUserName,
          twitterID,
          twitterURL,
        };
        break;
      }
      case 'matters': {
        const {
          displayName: mattersUserName,
          userId: mattersID,
          url: mattersURL,
        } = await socialLinkMatters(user, { accessToken, refreshToken });
        platformPayload = {
          mattersUserName,
          mattersID,
          mattersURL,
        };
        break;
      }
      default: break;
    }
    return platformPayload;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export * from './getPublicInfo';
