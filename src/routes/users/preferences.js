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
      const { locale, creatorPitch = '', paymentRedirectWhiteList = [] } = doc.data();
      res.json({ locale, creatorPitch, paymentRedirectWhiteList });
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

// https://stackoverflow.com/a/43467144/7978205
function isValidHttpUrl(string) {
  let url;

  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }

  return url.protocol === 'http:' || url.protocol === 'https:';
}

router.post('/preferences', jwtAuth('write:preferences'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const {
      locale,
      creatorPitch,
      paymentRedirectWhiteList: inputPaymentRedirectWhiteList,
    } = req.body;
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

    if (inputPaymentRedirectWhiteList !== undefined) {
      let paymentRedirectWhiteList = inputPaymentRedirectWhiteList === null
        ? [] : inputPaymentRedirectWhiteList;
      if (!Array.isArray(paymentRedirectWhiteList)) {
        res.status(400).send('INVALID_PAYMENT_REDIRECT_WHITELIST');
        return;
      }
      paymentRedirectWhiteList = [...new Set(paymentRedirectWhiteList)];
      paymentRedirectWhiteList = paymentRedirectWhiteList.filter(url => !!url);
      if (paymentRedirectWhiteList.some(url => !isValidHttpUrl(url))) {
        res.status(400).send('INVALID_PAYMENT_REDIRECT_URL');
        return;
      }
      payload.paymentRedirectWhiteList = paymentRedirectWhiteList;
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
