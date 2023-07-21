import { likeNFTConnectedUserCollection } from '../../firebase';

export async function getUserStripeConnectInfo(wallet: string) {
  const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
  const userData = userDoc.data();
  return userData;
}

export async function getUserIsStripeConnectReady(wallet: string) {
  const userData = await getUserStripeConnectInfo(wallet);
  const { isStripeConnectReady } = userData;
  return !isStripeConnectReady;
}
