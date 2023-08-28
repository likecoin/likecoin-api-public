import { getISCNDocByClassId, getISCNPrefixByClassId } from '..';
import { getNFTClassDataById, getNFTISCNOwner } from '../../../cosmos/nft';
import { likeNFTSubscriptionUserCollection } from '../../../firebase';
import { checkFreeMintExists } from '../free';

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
    if (currentPeriodEnd > now / 1000) {
      acc[w] = {
        ...userData[w],
      };
    }
    return acc;
  }, {});
  return activeSubscriptionsData;
}

export async function getActiveSubscriptionsOfCreator(wallet: string) {
  const readerQuery = await likeNFTSubscriptionUserCollection
    .where(`${wallet}.currentPeriodEnd`, '>', Math.round(Date.now() / 1000)).get();
  const readers = readerQuery.docs.map((doc) => ({ wallet: doc.id, ...doc.data()[wallet] }));
  return readers;
}

export async function getUserIsSubscriberOfCreator(user: string, creator: string) {
  const infoMap = await getSubscriptionUserActiveSubscriptionsData(user);
  if (!infoMap) return false;
  return infoMap[creator];
}

export async function getSubscriberCanCollectNFT(wallet: string, classId: string) {
  const iscnId = await getISCNPrefixByClassId(classId);
  const owner = await getNFTISCNOwner(iscnId);
  if (!owner) return {};
  getNFTClassDataById(classId);
  const [isSubscriber, hasFreeCollected, iscnDoc] = await Promise.all([
    getUserIsSubscriberOfCreator(wallet, owner),
    checkFreeMintExists(wallet, classId),
    getISCNDocByClassId(classId),
  ]);
  const { timestamp, collectExpiryAt: expiryDate } = iscnDoc.data();
  const defaultExpireTs = timestamp + 2592000000; // 30days
  const collectExpiryAt = Math.min(expiryDate?.toMillis() || defaultExpireTs, defaultExpireTs);
  const isExpired = Date.now() > collectExpiryAt;
  const canFreeCollect = isSubscriber && !isExpired && !hasFreeCollected;
  return {
    isSubscriber,
    collectExpiryAt,
    isExpired,
    canFreeCollect,
    hasFreeCollected,
  };
}
