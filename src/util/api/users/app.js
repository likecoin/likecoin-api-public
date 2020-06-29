import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import publisher from '../../gcloudPub';
import { getUserAgentPlatform } from './index';
import { addFollowUser } from './follow';

export function expandEmailFlags(user) {
  const {
    isBlackListed = false,
    isEmailVerified = false,
    isEmailBlackListed = false,
    isEmailDuplicated = false,
  } = user;
  return {
    isBlackListed,
    isEmailVerified,
    isEmailBlackListed,
    isEmailDuplicated,
  };
}

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
  if (username === appReferrer) return;
  const userAppMetaRef = dbRef.doc(username).collection('app').doc('meta');
  const referrerAppRefCol = dbRef.doc(appReferrer).collection('appReferrals');
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
  const metaPayload = {
    [agentType]: true,
    lastAccessedTs: Date.now(),
    referrer: appReferrer,
    ...expandEmailFlags(user),
    ts: Date.now(),
  };
  const deviceId = req.headers['x-device-id'];
  if (deviceId) {
    metaPayload[`${agentType}DeviceId`] = deviceId;
    metaPayload.deviceId = deviceId;
  }
  batch.set(userAppMetaRef, metaPayload, { merge: true });
  batch.create(referrerAppRefCol.doc(username), {
    ...expandEmailFlags(user),
    ts: Date.now(),
  });
  await Promise.all([
    batch.commit(),
    addFollowUser(username, appReferrer),
  ]);
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventUserFirstOpenApp',
    type: 'referral',
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
  const appMetaDocRef = dbRef.doc(username).collection('app').doc('meta');
  const appMetaDoc = await appMetaDocRef.get();
  if (appMetaDoc.exists && appMetaDoc.data().ts) {
    // user already have app first open log return;
    return;
  }
  const payload = {
    [agentType]: true,
    ...expandEmailFlags(user),
    lastAccessedTs: Date.now(),
    ts: Date.now(),
  };
  const deviceId = req.headers['x-device-id'];
  if (deviceId) {
    payload[`${agentType}DeviceId`] = deviceId;
    payload.deviceId = deviceId;
  }
  await appMetaDocRef.create();
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventUserFirstOpenApp',
    type: 'direct',
    user: username,
    email,
    ...expandEmailFlags(user),
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
  const updatePayload = {
    [agentType]: true,
    ...expandEmailFlags(user),
    lastAccessedTs: Date.now(),
  };
  const deviceId = req.headers['x-device-id'];
  if (deviceId) {
    updatePayload[`${agentType}DeviceId`] = deviceId;
    updatePayload.deviceId = deviceId;
  }
  const appMetaDocRef = dbRef.doc(username).collection('app').doc('meta');
  try {
    await appMetaDocRef.update(updatePayload);
  } catch (err) {
    updatePayload.ts = Date.now();
    await appMetaDocRef.create(updatePayload);
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
      agentType,
    });
  }
  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventUserOpenApp',
    user: username,
    agentType,
    email,
    displayName,
    avatar,
    referrer,
    locale,
    registerTime: timestamp,
  });
}
