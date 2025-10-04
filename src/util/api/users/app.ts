import {
  userCollection as dbRef,
  db,
} from '../../firebase';
import {
  PUBSUB_TOPIC_MISC,
} from '../../../constant';
import publisher from '../../gcloudPub';
import { getUserAgentPlatform, UserData } from './index';
import { addFollowUser } from './follow';
import { getAuthCoreUserById } from '../../authcore';
import { authCoreJwtSignToken } from '../../jwt';

const THREE_DAYS_IN_MS = 259200000;

export function expandEmailFlags(user) {
  const {
    isBlackListed = false,
    isEmailVerified = false,
    isEmailBlackListed = false,
    isEmailDuplicated = false,
    isPhoneVerified = false,
  } = user;
  return {
    isBlackListed,
    isEmailVerified,
    isEmailBlackListed,
    isEmailDuplicated,
    isPhoneVerified,
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
  const userAppMetaData = userAppMetaDoc.data();
  if (userAppMetaDoc.exists && userAppMetaData && userAppMetaData.ts) {
    // user already have app first open log return;
    return;
  }
  const agentType = getUserAgentPlatform(req);

  // TODO: set email verification payload

  const batch = db.batch();
  const metaPayload: any = {
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
  const referralAppRefData = {
    ...expandEmailFlags(user),
    ts: Date.now(),
  };
  batch.create(referrerAppRefCol.doc(username), referralAppRefData);
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
  const appMetaData = appMetaDoc.data();
  if (appMetaDoc.exists && appMetaData && appMetaData.ts) {
    // user already have app first open log return;
    return;
  }
  const payload: any = {
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
  await appMetaDocRef.create(payload);
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

export async function checkPhoneVerification(username: string) {
  const userDoc = await dbRef.doc(username).get();
  const userData: UserData | undefined = userDoc.data();
  if (!userData) return;
  const { authCoreUserId } = userData;
  if (!authCoreUserId) return;
  const authCoreToken = await authCoreJwtSignToken();
  const user = await getAuthCoreUserById(authCoreUserId, authCoreToken);
  const {
    isPhoneVerified,
    phone,
  } = user;
  if (isPhoneVerified) {
    await dbRef.doc(username).update({
      phone,
      isPhoneVerified,
    });
  }
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
  const updatePayload: any = {
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
  const appMetaDoc = await appMetaDocRef.get();
  const appMetaData = appMetaDoc.data();
  if (appMetaData) {
    await appMetaDocRef.update(updatePayload);
    const {
      ts,
      isPhoneVerified,
    } = appMetaData;
    if (!isPhoneVerified && Date.now() - ts < THREE_DAYS_IN_MS) {
      try {
        await checkPhoneVerification(username);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }
  } else {
    updatePayload.ts = Date.now();
    await appMetaDocRef.create(updatePayload);
    try {
      await checkPhoneVerification(username);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
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
