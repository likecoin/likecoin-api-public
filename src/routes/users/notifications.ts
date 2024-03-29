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

    const { after, before } = req.query;
    if (after) {
      try {
        queryRef = queryRef.endBefore(Number(after));
      } catch (err) {
        // no-op
      }
    }
    if (before) {
      try {
        queryRef = queryRef.startAfter(Number(before));
      } catch (err) {
        // no-op
      }
    }
    let limit;
    const { limit: limitInput } = req.query;
    if (limitInput) {
      try {
        limit = Number(limitInput);
      } catch (err) {
        // no-op
      }
    }
    if (!limit) {
      limit = 64;
    }
    const query = await queryRef.limit(Number(limit)).get();
    const list: any[] = [];
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
    const { before: beforeQs } = req.query;
    let before = 0;
    if (beforeQs) {
      try {
        before = Number(beforeQs);
      } catch (err) {
        res.status(400).send('INVALID_BEFORE');
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
      const batchCommits: Promise<any>[] = [];
      const maxOpsPerBatch = 500;
      for (let i = 0; i < query.docs.length; i += maxOpsPerBatch) {
        const batch = db.batch();
        const docs = query.docs.slice(i, i + maxOpsPerBatch);
        docs.forEach((doc) => {
          batch.update(doc.ref, { isRead: true });
        });
        batchCommits.push(batch.commit());
      }
      await Promise.all(batchCommits);
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
