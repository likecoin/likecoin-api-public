import { Router } from 'express';
import axios from 'axios';
import {
  ETH_NETWORK_NAME,
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  db,
  userCollection as dbRef,
} from '../../util/firebase';
import publisher from '../../util/gcloudPub';

const router = Router();

router.post('/medium', async (req, res) => {
  let url;
  let userId;
  try {
    ({ url, user: userId } = req.body);
    const userRef = dbRef.doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('USER_NOT_EXIST');
    if (userDoc.data().medium) throw new Error('MISSION_ALREADY_DONE');

    const inputMatch = url.match(/^https:\/\/medium.com\/@([._0-9a-zA-Z]*)\/.*$/);
    if (!inputMatch) throw new Error('MEDIUM_URL_INVALID');
    const mediumUsername = inputMatch[1];
    const getMediumRes = await axios.get(url);
    if (!getMediumRes || !getMediumRes.data) throw new Error('MEDIUM_URL_INVALID');
    // trim prepend string
    const trimIdentifier = '</x>';
    const trimPos = getMediumRes.data.indexOf(trimIdentifier) + trimIdentifier.length;
    const data = JSON.parse(getMediumRes.data.slice(trimPos));
    if (!data.success) throw new Error('MEDIUM_URL_INVALID');

    const { creatorId } = data.payload.value;
    const contents = data.payload.value.content.bodyModel.paragraphs;
    // check content includes user href
    const hrefRegex = new RegExp(`^https://like.co/${userId}(/[.0-9]*)?$`);
    let hasUserHref;
    for (let i = 0; i < contents.length; i += 1) {
      if (contents[i].mixtapeMetadata) {
        const match = contents[i].mixtapeMetadata.href.match(hrefRegex);
        if (match) {
          hasUserHref = true;
          break;
        }
      }
    }
    if (!hasUserHref) throw new Error('MEDIUM_CONTENT_INVALID');

    await db.runTransaction(async (t) => {
      const mediumQuery = dbRef.where('medium', '==', creatorId).limit(1);
      const mediumRes = await t.get(mediumQuery);
      if (mediumRes.docs.length > 0) throw new Error('MEDIUM_ALREADY_EXIST');
      const missionRef = dbRef.doc(userId).collection('mission').doc('medium');
      const d = await t.get(userRef);
      if (d.exists && d.data().medium) throw new Error('MISSION_ALREADY_DONE');
      const userMediumRef = dbRef.doc(userId).collection('medium').doc('account');
      const userMediumDoc = await t.get(userMediumRef);
      if (userMediumDoc.exists) throw new Error('MEDIUM_ALREADY_EXIST');
      return Promise.all([
        t.update(userRef, { medium: creatorId }),
        t.set(missionRef, { done: true, url }, { merge: true }),
        t.set(userMediumRef, { userId: creatorId, username: mediumUsername }, { merge: true }),
      ]);
    });
    const ethNetwork = ETH_NETWORK_NAME;
    const {
      wallet,
      email,
      displayName,
      referrer,
      timestamp: registerTime,
    } = userDoc.data();
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventMedium',
      ethNetwork,
      user: userId,
      wallet,
      displayName,
      email,
      referrer,
      mediumUserId: creatorId,
      mediumUsername,
      registerTime,
      url,
    });
    return res.json({ message: 'OK' });
  } catch (err) {
    console.error(`user: ${userId}, url: ${url}`); // eslint-disable-line no-console
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
