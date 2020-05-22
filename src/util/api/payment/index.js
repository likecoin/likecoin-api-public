import { userCollection as dbRef } from '../../firebase';

async function fetchUserInfoByCosmosWallet(wallet) {
  const query = dbRef.where('cosmosWallet', '==', wallet).get().then((snapshot) => {
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

async function fetchUserIdsByCosmosWallet(wallet) {
  const wallets = Array.isArray(wallet) ? wallet : [wallet];
  const walletQuerys = wallets.map(w => dbRef.where('cosmosWallet', '==', w).get().then((snapshot) => {
    if (snapshot.docs.length > 0) {
      return {
        id: snapshot.docs[0].id,
      };
    }
    return {};
  }));
  const result = await Promise.all(walletQuerys);
  return { id: result.map(r => r.id || '') };
}

export async function fetchPaymentUserInfo({ from, to }) {
  let fromQuery = Promise.resolve({});
  if (from) {
    fromQuery = Array.isArray(from)
      ? fetchUserIdsByCosmosWallet(from)
      : fetchUserInfoByCosmosWallet(from);
  }
  let toQuery = Promise.resolve({});
  if (to) {
    toQuery = Array.isArray(to)
      ? fetchUserIdsByCosmosWallet(to)
      : fetchUserInfoByCosmosWallet(to);
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
