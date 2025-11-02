import { Router } from 'express';
import type { AppMeta } from '../../types/firestore';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { filterAppMeta } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { jwtAuth } from '../../middleware/jwt';
import {
  handleAddAppReferrer,
} from '../../util/api/app';

const router = Router();

router.get('/meta', jwtAuth('read'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const doc = await dbRef.doc(user).collection('app').doc('meta').get();
    const appMetaData = (doc.data() || {}) as AppMeta;
    res.json(filterAppMeta(appMetaData));
  } catch (err) {
    next(err);
  }
});

router.post('/meta/referral', jwtAuth('write'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { referrer } = req.body;

    const userAppMetaRef = dbRef.doc(user).collection('app').doc('meta');
    if (user === referrer) throw new ValidationError('REFERRER_SAME_AS_USER');
    const [doc, referrerDoc] = await Promise.all([
      userAppMetaRef.get(),
      dbRef.doc(referrer).get(),
    ]);
    const data = (doc.data() || {}) as AppMeta;
    const { isNew } = filterAppMeta(data);
    const { referrer: existingReferrer } = data;
    if (!isNew) throw new ValidationError('NOT_NEW_APP_USER');
    if (existingReferrer) throw new ValidationError('REFERRER_ALREADY_SET');
    if (!referrerDoc.exists) throw new ValidationError('REFERRER_NOT_EXISTS');

    await handleAddAppReferrer(req, user, referrer);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
