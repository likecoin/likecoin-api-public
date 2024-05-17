import { ValidationError } from '../../../ValidationError';
import { likeNFTBookUserCollection } from '../../../firebase';
import { getUserWithCivicLikerProperties } from '../../users/getPublicInfo';

export async function getBookUserInfo(wallet: string) {
  const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
  const userData = userDoc.data();
  if (!userData) {
    return null;
  }
  return userData;
}

export async function getBookUserInfoFromLikerId(likerId: string) {
  const userInfo = await getUserWithCivicLikerProperties(likerId);
  if (!userInfo) return null;
  const { likeWallet } = userInfo;
  const user = await getBookUserInfo(likeWallet);
  return { likeWallet, ...user };
}

export async function getBookUserInfoFromLegacyString(from: string) {
  const userQuery = await likeNFTBookUserCollection.where('fromString', '==', from).limit(1).get();
  const userDoc = userQuery.docs[0];
  if (!userDoc) {
    return null;
  }
  const userData = userDoc.data();
  if (!userData) {
    return null;
  }
  return { likeWallet: userDoc.id, ...userData };
}

export async function getStripeConnectAccountId(wallet: string) {
  const userData = await getBookUserInfo(wallet);
  if (!userData) return null;
  const { stripeConnectAccountId, isStripeConnectReady } = userData;
  return isStripeConnectReady ? stripeConnectAccountId : null;
}

export async function getStripeConnectAccountIdFromLikerId(likerId: string) {
  const user = await getBookUserInfoFromLikerId(likerId);
  if (!user) return null;
  return user.isStripeConnectReady ? user.stripeConnectAccountId : null;
}

export async function getStripeConnectAccountIdFromLegacyString(from: string) {
  const user = await getBookUserInfoFromLegacyString(from);
  if (!user) return null;
  const { stripeConnectAccountId, isStripeConnectReady } = user;
  return isStripeConnectReady ? stripeConnectAccountId : null;
}

export async function validateConnectedWallets(connectedWallets: {[key: string]: number}) {
  if (Object.values(connectedWallets).reduce((a, b) => a + b, 0) > 100) {
    throw new ValidationError('INVALID_CONNECTED_WALLETS_VALUES');
  }
  const connectedWalletsKeys = Object.keys(connectedWallets);
  const userDocs = await Promise.all(connectedWalletsKeys
    .map((wallet) => likeNFTBookUserCollection.doc(wallet).get()));
  const userData = userDocs.map((u) => ({ id: u.id, ...(u.data() || {}) }));
  const invalidData = userData.find((u) => !u.isStripeConnectReady);
  if (invalidData) throw new ValidationError(`INVALID_CONNECTED_WALLETS: ${invalidData}`);
  return true;
}
