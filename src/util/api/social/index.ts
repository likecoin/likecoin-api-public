import parse from 'url-parse';
import { fetchMattersUser } from '../../oauth/matters';
import { ValidationError } from '../../ValidationError';
import { IS_LOGIN_SOCIAL, W3C_EMAIL_REGEX } from '../../../constant';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../firebase';

export async function socialLinkMatters(
  user,
  {
    accessToken: inputAccessToken = '',
    code = undefined,
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
  await Promise.all([
    dbRef.doc(user).collection('social').doc('matters').set({
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
    }, { merge: true }),
    dbRef.doc(user).update({
      mediaChannels: FieldValue.arrayUnion('matters'),
    }),
  ]);

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

export * from './getPublicInfo';
