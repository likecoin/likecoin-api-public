import { userCollection as dbRef } from '../../firebase';

export async function fetchPaymentUserInfo({ from, to, type = 'eth' }) {
  let fieldName;
  if (type === 'eth') fieldName = 'wallet';
  else if (type === 'cosmos') fieldName = 'cosmosWallet';
  const fromQuery = dbRef.where(fieldName, '==', from).get().then((snapshot) => {
    if (snapshot.docs.length > 0) {
      const fromUser = snapshot.docs[0].data();
      return {
        fromId: snapshot.docs[0].id,
        fromDisplayName: fromUser.displayName,
        fromEmail: fromUser.email,
        fromReferrer: fromUser.referrer,
        fromLocale: fromUser.locale,
        fromRegisterTime: fromUser.timestamp,
      };
    }
    return {};
  });
  const toQuery = dbRef.where(fieldName, '==', to).get().then((snapshot) => {
    if (snapshot.docs.length > 0) {
      const toUser = snapshot.docs[0].data();
      return {
        toId: snapshot.docs[0].id,
        toDisplayName: toUser.displayName,
        toEmail: toUser.email,
        toReferrer: toUser.referrer,
        toLocale: toUser.locale,
        toRegisterTime: toUser.timestamp,
        toSubscriptionURL: toUser.subscriptionURL,
      };
    }
    return {};
  });
  const [{
    fromId,
    fromDisplayName,
    fromEmail,
    fromReferrer,
    fromLocale,
    fromRegisterTime,
  }, {
    toId,
    toDisplayName,
    toEmail,
    toReferrer,
    toLocale,
    toRegisterTime,
    toSubscriptionURL,
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
