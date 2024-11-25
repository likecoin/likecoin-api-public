/* eslint-disable camelcase */
import { changeAddressPrefix } from '@likecoin/iscn-js/dist/iscn/addressParsing';
import { authCoreJwtSignToken } from '../../jwt';
import { registerAuthCoreUser, createAuthCoreWalletsViaServiceAccount } from '../../authcore';

export async function createAuthCoreUserAndWallet({
  user,
  email,
  displayName,
}, platforms: any[] = []) {
  const authCoreToken = await authCoreJwtSignToken();
  const registerPayload: {
    username: string;
    email: string;
    display_name: string;
    oauth_factors: any[];
  } = {
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
  const { cosmosWallet, evmWallet } = await createAuthCoreWalletsViaServiceAccount(
    authCoreUserId,
    authCoreToken,
  );
  const likeWallet = changeAddressPrefix(cosmosWallet, 'like');
  return {
    authCoreUserId,
    cosmosWallet,
    likeWallet,
    evmWallet,
  };
}

export default createAuthCoreUserAndWallet;
