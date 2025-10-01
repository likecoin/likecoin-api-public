import {
  userCollection as dbRef,
  FieldValue,
  db,
} from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { handleAvatarLinkAndGetURL } from '../../fileupload';
import type { UserData } from './getPublicInfo';

export async function handleClaimPlatformDelegatedUser(platform, user, {
  email,
  displayName,
  isEmailVerified,
  authCoreUserId,
  cosmosWallet,
  likeWallet,
  avatarURL,
}) {
  const userRef = dbRef.doc(user);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new ValidationError('USER_NOT_FOUND');
  const { delegatedPlatform, isPlatformDelegated } = userDoc.data() as UserData;
  if (!isPlatformDelegated || delegatedPlatform !== platform) {
    throw new ValidationError('USER_NOT_DELEGATED');
  }
  const payload: any = {
    isPlatformDelegated: false,
    delegatedPlatform: FieldValue.delete(),
  };
  if (email) payload.email = email;
  if (displayName) payload.displayName = displayName;
  if (isEmailVerified !== undefined) payload.isEmailVerified = isEmailVerified;
  if (authCoreUserId) payload.authCoreUserId = authCoreUserId;
  if (cosmosWallet) payload.cosmosWallet = cosmosWallet;
  if (likeWallet) payload.likeWallet = likeWallet;
  if (avatarURL) {
    try {
      payload.avatar = await handleAvatarLinkAndGetURL(user, avatarURL);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
  await userRef.update(payload);
}

export function handleTransferPlatformDelegatedUser(platform, user, target) {
  return db.runTransaction(async (t) => {
    const userRef = dbRef.doc(user);
    const userSocialRef = userRef.collection('social').doc(platform);
    const targetRef = dbRef.doc(target);
    const [
      userDoc,
      userSocialDoc,
      targetDoc,
    ] = await Promise.all([
      t.get(userRef),
      t.get(userSocialRef),
      t.get(targetRef),
    ]);
    if (!userDoc.exists) throw new ValidationError('USER_NOT_FOUND');
    if (!targetDoc.exists) throw new ValidationError('TARGET_NOT_FOUND');
    const {
      delegatedPlatform,
      isPlatformDelegated,
      isDeleted,
      pendingLIKE: sourcePendingLike,
    } = userDoc.data() as UserData;
    const {
      pendingLIKE: targetPendingLike,
    } = targetDoc.data() as UserData;
    if (isDeleted) {
      throw new ValidationError('USER_IS_DELETED');
    }
    if (!isPlatformDelegated || delegatedPlatform !== platform) {
      throw new ValidationError('USER_NOT_DELEGATED');
    }
    let pendingLIKE;
    if (sourcePendingLike) {
      if (targetPendingLike) {
        pendingLIKE = {};
        const keys = new Set(Object.keys(sourcePendingLike).concat(Object.keys(targetPendingLike)));
        keys.forEach((key) => {
          pendingLIKE[key] = (sourcePendingLike[key] || 0) + (targetPendingLike[key] || 0);
        });
      } else {
        pendingLIKE = sourcePendingLike;
      }
      t.update(targetRef, { pendingLIKE, isPendingLIKE: true });
      t.update(userRef, { pendingLIKE: FieldValue.delete(), isPendingLIKE: false });
      // TODO: actually delete the id?
    }
    if (userSocialDoc.exists) {
      t.set(targetRef.collection('social').doc(platform), userSocialDoc.data());
      t.delete(userSocialRef);
    }
    t.update(userRef, { isDeleted: true });
    // TODO: actually delete the id?
    return { pendingLIKE };
  });
}
