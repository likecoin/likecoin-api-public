import { authCoreJwtSignToken } from '../../jwt';
import { registerAuthCoreUser, createAuthCoreCosmosWalletIfNotExist } from '../../authcore';

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
  return {
    authCoreUserId,
    cosmosWallet,
  };
}

export default createAuthCoreUserAndWallet;
