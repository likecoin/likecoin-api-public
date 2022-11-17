import { userCollection as dbRef } from '../../firebase';

async function fetchUserInfoByCosmosLikeWallet(wallet) {
  const queryKey = wallet.startsWith('like') ? 'likeWallet' : 'cosmosWallet';
  const query = dbRef.where(queryKey, '==', wallet).get().then((snapshot) => {
    if (snapshot.docs.length > 0) {
      const userData = snapshot.docs[0].data();
      const {
        displayName,
        email,
        referrer,
        locale,
        timestamp: registerTime,
        subscriptionURL,
      } = userData;
      return {
        id: snapshot.docs[0].id,
        displayName,
        email,
        referrer,
        locale,
        registerTime,
        subscriptionURL,
      };
    }
    return {};
  });
  return query;
}

async function fetchUserIdsByCosmosLikeWallet(wallet) {
  const wallets = Array.isArray(wallet) ? wallet : [wallet];
  const walletQuerys = wallets.map((w) => {
    const queryKey = w.startsWith('like') ? 'likeWallet' : 'cosmosWallet';
    return dbRef.where(queryKey, '==', w).get()
      .then((snapshot) => {
        if (snapshot.docs.length > 0) {
          return {
            id: snapshot.docs[0].id,
          };
        }
        return {};
      });
  });
  const result = await Promise.all(walletQuerys);
  return { id: result.map(r => r.id || '') };
}

export async function fetchPaymentUserInfo({ from, to }: { from?: string; to?: string}) {
  let fromQuery: Promise<any> = Promise.resolve({});
  if (from) {
    fromQuery = Array.isArray(from)
      ? fetchUserIdsByCosmosLikeWallet(from)
      : fetchUserInfoByCosmosLikeWallet(from);
  }
  let toQuery: Promise<any> = Promise.resolve({});
  if (to) {
    toQuery = Array.isArray(to)
      ? fetchUserIdsByCosmosLikeWallet(to)
      : fetchUserInfoByCosmosLikeWallet(to);
  }
  const [{
    id: fromId,
    displayName: fromDisplayName,
    email: fromEmail,
    referrer: fromReferrer,
    locale: fromLocale,
    registerTime: fromRegisterTime,
  }, {
    id: toId,
    displayName: toDisplayName,
    email: toEmail,
    referrer: toReferrer,
    locale: toLocale,
    registerTime: toRegisterTime,
    subscriptionURL: toSubscriptionURL,
  }] = await Promise.all([fromQuery, toQuery]);
  return {
    fromId,
    fromDisplayName,
    fromEmail,
    fromReferrer,
    fromLocale,
    fromRegisterTime,
    toId,
    toDisplayName,
    toEmail,
    toReferrer,
    toLocale,
    toRegisterTime,
    toSubscriptionURL,
  };
}

export default fetchPaymentUserInfo;
