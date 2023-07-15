import { ValidationError } from '../../../ValidationError';
import { likeNFTConnectedUserCollection } from '../../../firebase';

export async function getStripeConnectAccountId(wallet: string) {
  const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
  const userData = userDoc.data();
  if (!userData) {
    return null;
  }
  const { stripeConnectAccountId, isStripeConnectReady } = userData;
  return isStripeConnectReady ? stripeConnectAccountId : null;
}

export async function validateConnectedWallets(connectedWallets: {[key: string]: number}) {
  if (Object.values(connectedWallets).reduce((a, b) => a + b, 0) > 100) {
    throw new ValidationError('INVALID_CONNECTED_WALLETS_VALUES');
  }
  const connectedWalletsKeys = Object.keys(connectedWallets);
  const userDocs = await Promise.all(connectedWalletsKeys
    .map((wallet) => likeNFTConnectedUserCollection.doc(wallet).get()));
  const userData = userDocs.map((u) => ({ id: u.id, ...(u.data() || {}) }));
  const invalidData = userData.find((u) => !u.isStripeConnectReady);
  if (invalidData) throw new ValidationError(`INVALID_CONNECTED_WALLETS: ${invalidData}`);
  return true;
}
