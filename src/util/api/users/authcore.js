import { authCoreJwtSignToken } from '../../jwt';
import { registerAuthCoreUser, createAuthCoreCosmosWalletIfNotExist } from '../../authcore';
import {
  db,
  userCollection as dbRef,
  userAuthCollection as authDbRef,
} from '../../firebase';

export async function createAuthCoreUserAndWallet({
  user,
  email,
  displayName,
}, platforms = []) {
  const authCoreToken = await authCoreJwtSignToken();
  const registerPayload = {
    username: user,
    email,
    display_name: displayName,
    oauth_factors: [],
  };
  platforms.forEach((p) => {
    registerPayload.oauth_factors.push({
      service: p.platform.toUpperCase(),
      oauth_user_id: p.platformUserId,
    });
  });
  const { id: authCoreUserId } = await registerAuthCoreUser(
    registerPayload,
    authCoreToken,
  );
  const cosmosWallet = await createAuthCoreCosmosWalletIfNotExist(authCoreUserId, authCoreToken);
  const batch = db.batch();
  batch.update(
    dbRef.doc(user), {
      authCoreUserId,
      cosmosWallet,
    },
  );
  batch.set(
    authDbRef.doc(user),
    { authcore: { userId: authCoreUserId } },
    { merge: true },
  );
  await batch.commit();
  return {
    authCoreUserId,
    cosmosWallet,
  };
}

export default createAuthCoreUserAndWallet;
