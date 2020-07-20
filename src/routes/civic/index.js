import { Router } from 'express';
import axios from 'axios';

import { jwtAuth } from '../../middleware/jwt';
import { configCollection as configRef } from '../../util/firebase';
import { CIVIC_LIKER_TRIAL_WEBHOOK } from '../../../config/config';

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
    if (!CIVIC_LIKER_TRIAL_WEBHOOK) {
      res.status(500).send('TRIAL_ENDPOINT_NOT_CONFIGURED');
      return;
    }
    const { eventId } = req.params;
    const payload = req.body || {};
    const response = await axios.post(
      CIVIC_LIKER_TRIAL_WEBHOOK,
      { ...payload, eventId },
      {
        headers: req.headers,
      },
    );
    res.status(response.status).header(response.headers).send(response.data);
  } catch (err) {
    if (err.reponse) {
      const { response } = err;
      res.status(response.status).header(response.headers).send(response.data);
      return;
    }
    next(err);
  }
});

export default router;
