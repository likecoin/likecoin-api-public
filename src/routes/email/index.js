import { Router } from 'express';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../util/firebase';
import publisher from '../../util/gcloudPub';
import { sendVerificationEmail, sendVerificationWithCouponEmail } from '../../util/ses';
import { ValidationError } from '../../util/ValidationError';

const uuidv4 = require('uuid/v4');

const THIRTY_S_IN_MS = 30000;

const router = Router();

router.post('/verify/user/:id/', async (req, res, next) => {
  try {
    const username = req.params.id;
    const { coupon, ref } = req.body;
    const userRef = dbRef.doc(username);
    const doc = await userRef.get();
    let user = {};
    let verificationUUID;
    if (doc.exists) {
      user = doc.data();
      if (!user.email) throw new ValidationError('Invalid email');
      if (user.isEmailVerified) throw new ValidationError('Already verified');
      if (user.lastVerifyTs && Math.abs(user.lastVerifyTs - Date.now()) < THIRTY_S_IN_MS) {
        throw new ValidationError('An email has already been sent recently, Please try again later');
      }
      ({ verificationUUID } = user);
      if (!verificationUUID) {
        verificationUUID = uuidv4();
        user.verificationUUID = verificationUUID;
      }
      await userRef.update({
        lastVerifyTs: Date.now(),
        verificationUUID,
      });
      try {
        if (coupon && /[2-9A-HJ-NP-Za-km-z]{8}/.test(coupon)) {
          await sendVerificationWithCouponEmail(res, user, coupon, ref);
        } else {
          await sendVerificationEmail(res, user, ref);
        }
      } catch (err) {
        await userRef.update({
          lastVerifyTs: FieldValue.delete(),
          verificationUUID: FieldValue.delete(),
        });
        throw err;
      }
    } else {
      res.sendStatus(404);
    }
    res.sendStatus(200);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventSendVerifyEmail',
      user: username,
      email: user.email,
      displayName: user.displayName,
      wallet: user.wallet,
      avatar: user.avatar,
      verificationUUID,
      referrer: user.referrer,
      locale: user.locale,
      registerTime: user.timestamp,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/verify/:uuid', async (req, res, next) => {
  try {
    const verificationUUID = req.params.uuid;
    const query = await dbRef.where('verificationUUID', '==', verificationUUID).get();
    if (query.docs.length > 0) {
      const [user] = query.docs;
      await user.ref.update({
        lastVerifyTs: FieldValue.delete(),
        verificationUUID: FieldValue.delete(),
        isEmailVerified: true,
      });

      const promises = [];
      const payload = { done: true };
      const { referrer } = user.data();
      if (referrer) {
        promises.push(dbRef.doc(referrer).collection('referrals').doc(user.id).update({ isEmailVerified: true }));
      } else {
        payload.bonusId = 'none';
      }
      promises.push(dbRef.doc(user.id).collection('mission').doc('verifyEmail').set(payload, { merge: true }));
      await Promise.all(promises);
      res.json({ referrer: !!user.data().referrer, wallet: user.data().wallet });
      const userObj = user.data();
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventVerify',
        user: user.id,
        email: userObj.email,
        displayName: userObj.displayName,
        wallet: userObj.wallet,
        avatar: userObj.avatar,
        verificationUUID,
        referrer: userObj.referrer,
        locale: userObj.locale,
        registerTime: userObj.timestamp,
      });
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
