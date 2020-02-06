import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import { jwtAuth } from '../../middleware/jwt';
import publisher from '../../util/gcloudPub';
import {
  db,
  userCollection as dbRef,
  subscriptionUserCollection as subscriptionDbRef,
  configCollection as configRef,
} from '../../util/firebase';

const router = Router();

router.get('/trial/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await configRef
      .doc('civicLiker')
      .collection('trialEvents')
      .doc(id)
      .get();

    if (!doc.exists) {
      res.sendStatus(404);
      return;
    }

    const {
      start,
      end,
      regCount,
      regQuota,
    } = doc.data();
    const now = Date.now();
    if (now < start) {
      res.sendStatus(404);
      return;
    }
    if (now > end || regCount >= regQuota) {
      res.sendStatus(410);
      return;
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post('/trial/events/:eventId/join', jwtAuth('write:civic_liker'), async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.user;

    const userDoc = await dbRef.doc(userId).get();
    if (!userDoc.exists) throw new Error('USER_NOT_EXIST');

    const subscriptionDoc = await subscriptionDbRef.doc(userId).get();
    if (subscriptionDoc.exists) {
      // User has past/active subscription
      res.sendStatus(409);
      return;
    }

    const subscription = await db.runTransaction(async (t) => {
      const trialEventRef = configRef
        .doc('civicLiker')
        .collection('trialEvents')
        .doc(eventId);
      const trialEventDoc = await trialEventRef.get();

      if (!trialEventDoc.exists) throw new Error('TRIAL_EVENT_NOT_FOUND');

      const {
        start,
        end,
        regCount,
        regQuota,
      } = trialEventDoc.data();
      const now = Date.now();
      if (now < start) throw new Error('TRIAL_EVENT_NOT_STARTED');
      if (now > end) throw new Error('TRIAL_EVENT_EXPIRED');
      if (regCount >= regQuota) throw new Error('TRIAL_EVENT_FULL');

      const trialEnd = new Date(now);
      trialEnd.setMonth(trialEnd.getMonth() + 1);
      const createObj = {
        eventId,
        since: now,
        currentType: 'trial',
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd.getTime(),
      };
      await t.update(trialEventRef, { regCount: regCount + 1 });
      await t.create(subscriptionDbRef.doc(userId), createObj);
      return createObj;
    });

    res.json({
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
    });

    const {
      email,
      displayName,
      wallet,
      referrer,
      locale,
      timestamp: registerTime,
      mediaChannel,
    } = userDoc.data();
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventCivicLikerTrial',
      user: userId,
      email,
      displayName,
      wallet,
      referrer,
      locale,
      registerTime,
      mediaChannel,
    });
  } catch (err) {
    if (err && err.message) {
      switch (err.message) {
        case 'TRIAL_EVENT_NOT_FOUND':
        case 'TRIAL_EVENT_NOT_STARTED':
          res.sendStatus(404);
          return;

        case 'TRIAL_EVENT_FULL':
        case 'TRIAL_EVENT_EXPIRED':
          res.sendStatus(410);
          return;

        default:
      }
    }
    next(err);
  }
});

export default router;
