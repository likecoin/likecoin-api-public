import {
  userCollection as dbRef,
  FieldValue,
} from '../../firebase';
import { ValidationError } from '../../ValidationError';

export async function handleClaimPlatformDelegatedUser(user, platform, {
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

export default handleClaimPlatformDelegatedUser;
