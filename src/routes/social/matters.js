import { Router } from 'express';
import { checkPlatformAlreadyLinked, socialLinkMatters } from '../../util/api/social';
import { fetchMattersOAuthInfo } from '../../util/oauth/matters';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import publisher from '../../util/gcloudPub';
import { jwtAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import { userCollection as dbRef } from '../../util/firebase';

const router = Router();

router.get('/link/matters/:user', jwtAuth('read'), async (req, res, next) => {
  try {
    const { user } = req.params;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    if (await checkPlatformAlreadyLinked(user, 'matters')) {
      throw new ValidationError('already linked');
    }
    const { url, state } = await fetchMattersOAuthInfo(user);
    await dbRef.doc(user).collection('social').doc('matters').set({
      state,
    }, { merge: true });
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

router.post('/link/matters', jwtAuth('write'), async (req, res, next) => {
  try {
    const {
      state,
      code,
      user,
    } = req.body;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    if (!state || !code || !user) {
      throw new ValidationError('invalid payload');
    }
    const doc = await dbRef.doc(user).collection('social').doc('matters').get();
    const {
      state: dbState,
      isLinked,
    } = doc.data();

    if (isLinked) throw new ValidationError('already linked');
    if (state !== dbState) {
      throw new ValidationError('oauth state not match');
    }
    const {
      userId,
      displayName,
      fullName,
      url,
      imageUrl,
    } = await socialLinkMatters(user, { code });
    res.json({
      platform: 'matters',
      displayName,
      url,
    });
    const userDoc = await dbRef.doc(user).get();
    const {
      email,
      displayName: userDisplayName,
      wallet,
      referrer,
      locale,
      timestamp,
    } = userDoc.data();
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventSocialLink',
      platform: 'matters',
      user,
      email: email || undefined,
      displayName: userDisplayName,
      wallet,
      referrer: referrer || undefined,
      locale,
      mattersId: userId,
      mattersName: fullName,
      mattersUserName: displayName,
      mattersImageUrl: imageUrl,
      registerTime: timestamp,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
