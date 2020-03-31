import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import publisher from '../../gcloudPub';
import { getUserAgentPlatform } from './index';

export async function handleAppReferrer(req, user, referrer) {
  const userAppMetaRef = dbRef.doc(user).collection('app').doc('!meta');
  const referrerAppRefCol = dbRef.doc(referrer).collection('app');
  const [
    userAppMetaDoc,
    referrerDoc,
  ] = await Promise.all([
    userAppMetaRef.get(),
    dbRef.doc(referrer).get(),
  ]);
  if (!referrerDoc.exists) return;
  if (userAppMetaDoc.exists && userAppMetaDoc.data().ts) {
    // user already have app first open log return;
    return;
  }
  const agentType = getUserAgentPlatform(req);

  // TODO: set email verification payload

  const batch = db.batch();
  batch.set(userAppMetaDoc, {
    [agentType]: true,
    lastAccessedTs: Date.now(),
    referrer,
  }, { merge: true });
  batch.create(referrerAppRefCol.doc(user), { ts: Date.now() });
  await batch.commit();
}

export async function lazyUpdateAppMetaData(req, user, agentType) {
  const {
    user: username,
    avatar,
    referrer,
    displayName,
    email,
    locale,
    timestamp,
  } = user;
  const appMetaDocRef = dbRef.doc(username).collection('app').doc('!meta');
  try {
    await appMetaDocRef.update({
      [agentType]: true,
      lastAccessedTs: Date.now(),
    });
  } catch (err) {
    await appMetaDocRef.create({
      [agentType]: true,
      lastAccessedTs: Date.now(),
      ts: Date.now(),
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventUserFirstOpenApp',
      type: 'legacy',
      user: username,
      email,
      displayName,
      avatar,
      referrer,
      locale,
      registerTime: timestamp,
    });
  }
}
