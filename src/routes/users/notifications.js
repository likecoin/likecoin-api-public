import { Router } from 'express';
import { db, userCollection as dbRef } from '../../util/firebase';
import { filterNotification } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';

const router = Router();

router.get('/notifications', jwtAuth('read:notifications'), async (req, res, next) => {
  try {
    const { user } = req.user;
    let queryRef = dbRef
      .doc(user)
      .collection('notifications')
      .orderBy('ts', 'desc');

    let { after, before, limit } = req.query;
    if (after) {
      try {
        after = Number(after);
        queryRef = queryRef.endBefore(after);
      } catch (err) {
        // no-op
      }
    }
    if (before) {
      try {
        before = Number(before);
        queryRef = queryRef.startAfter(before);
      } catch (err) {
        // no-op
      }
    }
    if (limit) {
      try {
        limit = Number(limit);
      } catch (err) {
        // no-op
      }
    }
    if (!limit) {
      limit = 64;
    }
    const query = await queryRef.limit(limit).get();
    const list = [];
    query.docs.forEach((d) => {
      list.push(filterNotification({ id: d.id, ...d.data() }));
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read', jwtAuth('write:notifications'), async (req, res, next) => {
  try {
    const { user } = req.user;
    let { before } = req.query;
    if (before) {
      try {
        before = Number(before);
      } catch (err) {
        res.status(400).send('MISSING_BEFORE');
        return;
      }
    }
    const query = await dbRef
      .doc(user)
      .collection('notifications')
      .where('isRead', '==', false)
      .orderBy('ts', 'desc')
      .startAfter(before)
      .get();
    if (query.docs.length) {
      const batch = db.batch();
      query.docs.forEach((d) => {
        batch.update(d.ref, { isRead: true });
      });
      await batch.commit();
    }
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/:id/read', jwtAuth('write:notifications'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    await dbRef
      .doc(user)
      .collection('notifications')
      .doc(id)
      .update({ isRead: true });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.delete('/notifications/:id', jwtAuth('write:notifications'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    await dbRef
      .doc(user)
      .collection('notifications')
      .doc(id)
      .delete();
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
