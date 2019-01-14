import { Router } from 'express';
import axios from 'axios';
import {
  ETH_NETWORK_NAME,
  PUBSUB_TOPIC_MISC,
  OICE_API_HOST,
} from '../../../constant';
import {
  db,
  userCollection as dbRef,
} from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';

const router = Router();

router.post('/registerOice', async (req, res) => {
  const { user: userId } = req.body;
  try {
    const userRef = dbRef.doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('USER_NOT_EXIST');

    const url = `${OICE_API_HOST}/user/likecoin/${userId}`;
    let getOiceRes;
    try {
      getOiceRes = await axios.get(url);
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      throw new Error('OICE_SERVER_ERROR');
    }
    if (!getOiceRes || !getOiceRes.data) throw new Error('OICE_URL_INVALID');
    if (getOiceRes.data !== 'OK') throw new Error('OICE_LIKECOIN_ID_NOT_BIND');

    await db.runTransaction(async (t) => {
      const missionRef = dbRef.doc(userId).collection('mission').doc('registerOice');
      const d = await t.get(missionRef);
      if (d.exists && d.data().done) throw new Error('MISSION_ALREADY_DONE');
      return t.set(missionRef, { done: true }, { merge: true });
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
      logType: 'eventMissionRegisterOice',
      ethNetwork,
      user: userId,
      wallet,
      displayName,
      email,
      referrer,
      registerTime,
    });
    return res.json({ message: 'OK' });
  } catch (err) {
    console.error(`user: ${userId}`); // eslint-disable-line no-console
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
