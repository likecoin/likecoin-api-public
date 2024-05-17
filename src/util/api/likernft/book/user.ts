import { ValidationError } from '../../../ValidationError';
import { likeNFTBookUserCollection } from '../../../firebase';
import {
  getUserWithCivicLikerProperties,
  getUserWithCivicLikerPropertiesByWallet,
} from '../../users/getPublicInfo';

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
  return { likeWallet, bookUserInfo: user, likerUserInfo: userInfo };
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
  const likeWallet = userDoc.id;
  const likerUserInfo = await getUserWithCivicLikerPropertiesByWallet(likeWallet);
  return { likeWallet: userDoc.id, bookUserInfo: userData, likerUserInfo };
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
