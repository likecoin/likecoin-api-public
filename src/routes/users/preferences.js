import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import { userCollection as dbRef } from '../../util/firebase';
import { supportedLocales } from '../../locales';

const router = Router();

router.get('/preferences', jwtAuth('read:preferences'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const doc = await dbRef.doc(user).get();
    if (doc.exists) {
      const { locale } = doc.data();
      res.json({ locale });
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

router.post('/preferences', jwtAuth('write:preferences'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { locale } = req.body;
    if (!supportedLocales.includes(locale)) {
      res.status(400).send('INVALID_LOCALE');
      return;
    }
    await dbRef.doc(user).update({ locale });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
