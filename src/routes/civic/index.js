import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import { jwtAuth } from '../../util/jwt';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users';
import publisher from '../../util/gcloudPub';
import {
  userCollection as dbRef,
  configCollection as configRef,
} from '../../util/firebase';

const router = Router();

router.put('/queue/user/:id', jwtAuth('write'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      from: civicReferrer,
      referrer: civicSourceURL,
    } = req.query;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    const payload = await getUserWithCivicLikerProperties(id);
    if (!payload) throw new Error('USER_NOT_EXIST');

    const {
      email,
      displayName,
      wallet,
      referrer,
      locale,
      timestamp: registerTime,
      currentPeriodEnd,
      currentPeriodStart,
    } = payload;

    const now = Date.now();
    if (now >= currentPeriodStart && now <= currentPeriodEnd) {
      res.status(401).send('ALREADY_CIVIC_LIKER');
    }

    await dbRef.doc(id).update({ civicLikerStatus: 'waiting' });

    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventCivicLikerQueue',
      type: 'queue',
      user: id,
      email,
      displayName,
      wallet,
      referrer,
      locale,
      registerTime,
      civicReferrer,
      civicSourceURL,
    });
  } catch (err) {
    next(err);
  }
});


router.delete('/queue/user/:id', jwtAuth('write'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      from: civicReferrer,
      referrer: civicSourceURL,
    } = req.query;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    const payload = await getUserWithCivicLikerProperties(id);
    if (!payload) throw new Error('USER_NOT_EXIST');

    const {
      email,
      displayName,
      wallet,
      referrer,
      locale,
      timestamp: registerTime,
      currentPeriodEnd,
      currentPeriodStart,
    } = payload;

    const now = Date.now();
    if (now >= currentPeriodStart && now <= currentPeriodEnd) {
      res.status(401).send('ALREADY_CIVIC_LIKER');
    }

    await dbRef.doc(id).update({ civicLikerStatus: 'intercom' });

    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventCivicLikerQueue',
      type: 'intercom',
      user: id,
      email,
      displayName,
      wallet,
      referrer,
      locale,
      registerTime,
      civicReferrer,
      civicSourceURL,
    });
  } catch (err) {
    next(err);
  }
});


router.get('/csonline', async (req, res, next) => {
  try {
    const doc = await configRef.doc('civicLiker').get();
    const { isCSOnline = false } = (doc.exists && doc.data()) || {};
    res.json({ isCSOnline });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

export default router;
