import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterNotification } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';

const router = Router();

router.get('/notifications', jwtAuth('read'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { limit = 64 } = req.query;
    const query = await dbRef
      .doc(user)
      .collection('notifications')
      .orderBy('ts', 'desc')
      .limit(limit)
      .get();
    const list = [];
    query.docs.forEach((d) => {
      list.push(filterNotification({ id: d.id, ...d.data() }));
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/:id/read', jwtAuth('write'), async (req, res, next) => {
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

router.delete('/notifications/:id', jwtAuth('write'), async (req, res, next) => {
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
