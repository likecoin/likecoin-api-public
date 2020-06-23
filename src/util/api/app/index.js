import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import publisher from '../../gcloudPub';

export async function handleAddAppReferrer(req, username, appReferrer) {
  const userAppMetaRef = dbRef.doc(username).collection('app').doc('meta');
  const referrerAppRefCol = dbRef.doc(appReferrer).collection('appReferrals');
  const userDoc = await dbRef.doc(username).get();
  const {
    avatar,
    referrer,
    displayName,
    email,
    isBlackListed = false,
    isEmailVerified = false,
    isEmailBlackListed = false,
    isEmailDuplicated = false,
    locale,
    timestamp,
  } = userDoc.data();
  const batch = db.batch();
  batch.set(userAppMetaRef, {
    referrer: appReferrer,
    isBlackListed,
    isEmailVerified,
    isEmailBlackListed,
    isEmailDuplicated,
  }, { merge: true });
  batch.create(referrerAppRefCol.doc(username), {
    isBlackListed,
    isEmailVerified,
    isEmailBlackListed,
    isEmailDuplicated,
    ts: Date.now(),
  });
  await batch.commit();
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventAddAppReferrer',
    user: username,
    email,
    isBlackListed,
    isEmailVerified,
    isEmailBlackListed,
    isEmailDuplicated,
    displayName,
    avatar,
    appReferrer,
    referrer,
    locale,
    registerTime: timestamp,
  });
}

export default handleAddAppReferrer;
