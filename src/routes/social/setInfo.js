import { Router } from 'express';

import {
  DISPLAY_SOCIAL_MEDIA_OPTIONS,
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import publisher from '../../util/gcloudPub';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { getLinkOrderMap } from '../../util/api/social';
import { tryToUnlinkOAuthLogin } from '../../util/api/users';
import { jwtAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import {
  filterSocialPlatformPersonal,
  filterSocialLinksPersonal,
  filterSocialLinksMeta,
} from '../../util/ValidationHelper';

const router = Router();

router.get('/list/:id/details', jwtAuth('read'), async (req, res, next) => {
  try {
    const username = req.params.id;
    if (req.user.user !== username) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    const col = await dbRef.doc(username).collection('social').get();
    const replyObj = {
      platforms: {},
      links: {},
      meta: {
        displaySocialMediaOption: DISPLAY_SOCIAL_MEDIA_OPTIONS[0],
      },
    };

    const linkOrderMap = getLinkOrderMap(col);
    col.docs.forEach((d) => {
      const { userId, isLinked, isExternalLink } = d.data();
      if (isLinked || userId) { // treat as linked if userId exists
        replyObj.platforms[d.id] = filterSocialPlatformPersonal({ ...d.data() });
      } else if (isExternalLink) {
        replyObj.links[d.id] = filterSocialLinksPersonal({ ...d.data() });
        replyObj.links[d.id].order = linkOrderMap[d.id];
      }
      if (d.id === 'meta') {
        replyObj.meta = filterSocialLinksMeta({ ...d.data() });
      }
    });

    res.json(replyObj);
  } catch (err) {
    next(err);
  }
});

router.post('/unlink/:platform', jwtAuth('write'), async (req, res, next) => {
  try {
    const { platform } = req.params;
    const {
      user,
    } = req.body;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    await tryToUnlinkOAuthLogin({
      likeCoinId: user,
      platform,
    });

    const socialDoc = await dbRef.doc(user).collection('social').doc(platform).get();
    if (!socialDoc.exists) throw new ValidationError('platform unknown');
    await socialDoc.ref.delete();

    res.sendStatus(200);
    const userDoc = await dbRef.doc(user).get();
    const {
      email,
      displayName,
      wallet,
      referrer,
      locale,
      timestamp,
    } = userDoc.data();
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventSocialUnlink',
      platform,
      user,
      email: email || undefined,
      displayName,
      wallet,
      referrer: referrer || undefined,
      locale,
      registerTime: timestamp,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/public', jwtAuth('write'), async (req, res, next) => {
  try {
    const {
      user,
      platforms = {},
      displaySocialMediaOption,
    } = req.body;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    const promises = Object.keys(platforms).map((id) => {
      const userReferralRef = dbRef.doc(user).collection('social').doc(id);
      return userReferralRef.update({ isPublic: platforms[id] });
    });

    if (DISPLAY_SOCIAL_MEDIA_OPTIONS.includes(displaySocialMediaOption)) {
      promises.push(
        dbRef.doc(user).collection('social').doc('meta').set({
          displaySocialMediaOption,
        }, { merge: true }),
      );
    }

    await Promise.all(promises);

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
