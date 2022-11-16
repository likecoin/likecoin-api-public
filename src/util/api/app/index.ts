import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import {
  expandEmailFlags,
} from '../users/app';
import { addFollowUser } from '../users/follow';
import publisher from '../../gcloudPub';

export async function handleAddAppReferrer(req, username, appReferrer) {
  const userAppMetaRef = dbRef.doc(username).collection('app').doc('meta');
  const referrerAppRefCol = dbRef.doc(appReferrer).collection('appReferrals');
  const userDoc = await dbRef.doc(username).get();
  const user = userDoc.data();
  const {
    avatar,
    referrer,
    displayName,
    email,
    locale,
    timestamp,
  } = user;
  const batch = db.batch();
  batch.set(userAppMetaRef, {
    referrer: appReferrer,
    ...expandEmailFlags(user),
  }, { merge: true });
  batch.create(referrerAppRefCol.doc(username), {
    ...expandEmailFlags(user),
    ts: Date.now(),
  });
  await Promise.all([
    batch.commit(),
    addFollowUser(username, appReferrer),
  ]);
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventAddAppReferrer',
    user: username,
    email,
    ...expandEmailFlags(user),
    displayName,
    avatar,
    appReferrer,
    referrer,
    locale,
    registerTime: timestamp,
  });
}

export default handleAddAppReferrer;
