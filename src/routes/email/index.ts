import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import type { UserData } from '../../types/user';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../util/firebase';
import publisher from '../../util/gcloudPub';
import { sendVerificationEmail } from '../../util/sendgrid';
import { ValidationError } from '../../util/ValidationError';

const THIRTY_S_IN_MS = 30000;

const router = Router();

router.post('/verify/user/:id/', async (req, res, next) => {
  try {
    const username = req.params.id;
    const { ref } = req.body;
    const userRef = dbRef.doc(username);
    const doc = await userRef.get();
    let user: UserData = {} as UserData;
    let verificationUUID: string | undefined;
    if (doc.exists) {
      user = doc.data() as UserData;
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
        await sendVerificationEmail(res, user, ref);
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

      const promises: Promise<unknown>[] = [];
      const payload: Record<string, unknown> = { done: true };
      const { referrer } = user.data();
      if (referrer) {
        promises.push(dbRef.doc(referrer).collection('referrals').doc(user.id).update({ isEmailVerified: true }));
      } else {
        payload.bonusId = 'none';
      }
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
