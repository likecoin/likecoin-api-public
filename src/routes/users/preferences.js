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
      const { locale, creatorPitch = '' } = doc.data();
      res.json({ locale, creatorPitch });
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
    const { locale, creatorPitch } = req.body;
    const payload = {};

    if (locale) {
      if (!supportedLocales.includes(locale)) {
        res.status(400).send('INVALID_LOCALE');
        return;
      }
      payload.locale = locale;
    }

    if (creatorPitch !== undefined) {
      if (typeof creatorPitch !== 'string') {
        res.status(400).send('INVALID_CREATOR_PITCH');
        return;
      }
      let charSizeCount = 0;
      let i = 0;
      for (; i < creatorPitch.length; i += 1) {
        const charSize = creatorPitch.charCodeAt(i) < 127 ? 1 : 2;
        if (charSizeCount + charSize <= 150) {
          charSizeCount += charSize;
        } else {
          break;
        }
      }
      payload.creatorPitch = creatorPitch.slice(0, i);
    }

    if (Object.keys(payload)) {
      await dbRef.doc(user).update(payload);
    }
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
