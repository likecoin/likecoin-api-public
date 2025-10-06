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
import type { UserData } from '../../../types/user';

export async function handleAddAppReferrer(req, username: string, appReferrer: string) {
  const userAppMetaRef = dbRef.doc(username).collection('app').doc('meta');
  const referrerAppRefCol = dbRef.doc(appReferrer).collection('appReferrals');
  const userDoc = await dbRef.doc(username).get();
  const user: UserData | undefined = userDoc.data();
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
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
