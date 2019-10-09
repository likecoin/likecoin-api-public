import {
  userCollection as dbRef,
  userAuthCollection as authDbRef,
  FieldValue,
  db,
} from '../../firebase';
import { socialLinkMatters } from '../social';
import { ValidationError } from '../../ValidationError';

export async function handleClaimPlatformDelegatedUser(platform, user, {
  email,
  displayName,
  isEmailVerified,
}) {
  const userRef = dbRef.doc(user);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new ValidationError('USER_NOT_FOUND');
  const { delegatedPlatform, isPlatformDelegated } = userDoc.data();
  if (!isPlatformDelegated || delegatedPlatform !== platform) {
    throw new ValidationError('USER_NOT_DELEGATED');
  }
  const payload = {
    isPlatformDelegated: false,
    delegatedPlatform: FieldValue.delete(),
  };
  if (email) payload.email = email;
  if (displayName) payload.displayName = displayName;
  if (isEmailVerified !== undefined) payload.isEmailVerified = isEmailVerified;
  await userRef.update(payload);
}

export async function handleTransferPlatformDelegatedUser(platform, user, target) {
  await db.runTransaction(async (t) => {
    const userRef = dbRef.doc(user);
    const userSocialRef = userRef.collection('social').doc(platform);
    const targetRef = dbRef.doc(target);
    const userAuthRef = authDbRef.doc(user);
    const targetAuthRef = authDbRef.doc(target);
    const [
      userDoc,
      userSocialDoc,
      targetDoc,
      userAuthDoc,
      targetAuthDoc,
    ] = await Promise.all([
      t.get(userRef),
      t.get(userSocialRef),
      t.get(targetRef),
      t.get(userAuthRef),
      t.get(targetAuthRef),
    ]);
    if (!userDoc.exists) throw new ValidationError('USER_NOT_FOUND');
    if (!targetDoc.exists) throw new ValidationError('TARGET_NOT_FOUND');
    const {
      delegatedPlatform,
      isPlatformDelegated,
      pendingLIKE: sourcePendingLike,
    } = userDoc.data();
    const {
      pendingLIKE: targetPendingLike,
    } = targetDoc.data();
    if (!isPlatformDelegated || delegatedPlatform !== platform) {
      throw new ValidationError('USER_NOT_DELEGATED');
    }
    if (userAuthDoc.exists) {
      const { [platform]: { userId: sourceUserId } } = userAuthDoc.data();
      if (targetAuthDoc.exists) {
        const { [platform]: { userId: targetUserId } } = targetAuthDoc.data();
        if (targetUserId && targetUserId !== sourceUserId) {
          throw new ValidationError('TARGET_USER_ALREADY_BINDED');
        }
      } else {
        t.set(targetAuthRef, { [platform]: { userId: sourceUserId } }, { merge: true });
        t.update(userAuthRef, { [platform]: FieldValue.delete() });
      }
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
      t.update(targetRef, { pendingLIKE });
      t.update(userRef, { pendingLIKE: FieldValue.delete() });
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

export async function handlePlatformOAuthBind(platform, user, platformToken) {
  if (platform === 'matters') { // TODO: switch case
    const {
      userId,
      displayName,
    } = await socialLinkMatters(user, { accessToken: platformToken });
    await authDbRef.doc(userId).set({ [platform]: { userId } }, { merge: true });
    return {
      userId,
      displayName,
    };
  }
  throw new ValidationError('UNKNOWN_ERROR');
}
