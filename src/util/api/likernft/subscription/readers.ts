import { likeNFTSubscriptionUserCollection } from '../../../firebase';

export async function getSubscriptionUserInfo(wallet: string) {
  const userDoc = await likeNFTSubscriptionUserCollection.doc(wallet).get();
  const userData = userDoc.data();
  return userData;
}

export async function getSubscriptionUserActiveSubscriptionsData(wallet: string) {
  const userData = await getSubscriptionUserInfo(wallet);
  if (!userData) return null;
  const wallets = Object.keys(userData).filter((k) => k.startsWith('like1'));
  const activeSubscriptionsData = wallets.reduce((acc, w) => {
    const { currentPeriodEnd } = userData[w];
    const now = Date.now();
    if (currentPeriodEnd > now) {
      acc[w] = {
        ...userData[w],
      };
    }
    return acc;
  }, {});
  return activeSubscriptionsData;
}
