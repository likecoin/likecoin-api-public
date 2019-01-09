import { Router } from 'express';
import { jwtAuth } from '../../util/jwt';
import publisher from '../../util/gcloudPub';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { sendInvitationEmail } from '../../util/ses';
import {
  ETH_NETWORK_NAME,
  PUBSUB_TOPIC_MISC,
} from '../../constant';

const router = Router();

router.post('/store-invite', jwtAuth('write'), async (req, res) => {
  try {
    const { referrerId, email, locale } = req.body;
    if (req.user.user !== referrerId) {
      return res.status(401).send('LOGIN_NEEDED');
    }
    const nowTs = Date.now();
    if (!referrerId || !email) throw new Error('Invalid payload');
    const referrer = await dbRef.doc(referrerId).get();
    if (!referrer.exists) throw new Error('User not exist');
    const { displayName, lastInvitationTs } = referrer.data();
    if (lastInvitationTs && Math.abs(lastInvitationTs - nowTs) < 1000) {
      throw new Error('Too many requests');
    }
    req.setLocale(locale);
    await sendInvitationEmail(req, {
      referrerId,
      email,
      referrer: displayName || referrerId,
    });
    await Promise.all([
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventInviteEmailSent',
        ethNetwork: ETH_NETWORK_NAME,
        user: referrerId,
        email,
      }),
      dbRef.doc(referrerId).update({
        lastInvitationTs: nowTs,
      }),
    ]);
    return res.json({ user: referrerId, email, ts: nowTs });
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
