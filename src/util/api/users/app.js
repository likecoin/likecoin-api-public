import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import publisher from '../../gcloudPub';
import { getUserAgentPlatform } from './index';

export async function handleAppReferrer(req, user, appReferrer) {
  const {
    user: username,
    avatar,
    referrer,
    displayName,
    email,
    locale,
    timestamp,
  } = user;
  const userAppMetaRef = dbRef.doc(username).collection('app').doc('!meta');
  const referrerAppRefCol = dbRef.doc(appReferrer).collection('app');
  const [
    userAppMetaDoc,
    appReferrerDoc,
  ] = await Promise.all([
    userAppMetaRef.get(),
    dbRef.doc(appReferrer).get(),
  ]);
  if (!appReferrerDoc.exists) return;
  if (userAppMetaDoc.exists && userAppMetaDoc.data().ts) {
    // user already have app first open log return;
    return;
  }
  const agentType = getUserAgentPlatform(req);

  // TODO: set email verification payload

  const batch = db.batch();
  batch.set(userAppMetaRef, {
    [agentType]: true,
    lastAccessedTs: Date.now(),
    referrer: appReferrer,
  }, { merge: true });
  batch.create(referrerAppRefCol.doc(username), { ts: Date.now() });
  await batch.commit();
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventUserFirstOpenApp',
    type: 'referral',
    user: username,
    email,
    displayName,
    avatar,
    appReferrer,
    referrer,
    locale,
    registerTime: timestamp,
  });
}

export async function handleUpdateAppMetaData(req, user) {
  const {
    user: username,
    avatar,
    referrer,
    displayName,
    email,
    locale,
    timestamp,
  } = user;
  const agentType = getUserAgentPlatform(req);
  const appMetaDocRef = dbRef.doc(username).collection('app').doc('!meta');
  const appMetaDoc = await appMetaDocRef.get();
  if (appMetaDoc.exists && appMetaDoc.data().ts) {
    // user already have app first open log return;
    return;
  }
  await appMetaDocRef.create({
    [agentType]: true,
    lastAccessedTs: Date.now(),
    ts: Date.now(),
  });
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventUserFirstOpenApp',
    type: 'direct',
    user: username,
    email,
    displayName,
    avatar,
    referrer,
    locale,
    registerTime: timestamp,
  });
}

export async function lazyUpdateAppMetaData(req, user) {
  const {
    user: username,
    avatar,
    referrer,
    displayName,
    email,
    locale,
    timestamp,
  } = user;
  const agentType = getUserAgentPlatform(req);
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
