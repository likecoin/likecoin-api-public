import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterFollow } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { addFollowUser } from '../../util/api/users/follow';

const router = Router();

router.get('/follow/users', jwtAuth('read:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const {
      limit = 64,
      filter,
    } = req.query;
    let queryRef = dbRef
      .doc(user)
      .collection('follow');
    if (filter === 'followed') {
      queryRef = queryRef.where('isFollowed', '==', true);
    } else if (filter === 'unfollowed') {
      queryRef = queryRef.where('isFollowed', '==', false);
    }
    const query = await queryRef
      .orderBy('ts', 'desc')
      .limit(limit)
      .get();
    const list = [];
    query.docs.forEach((d) => {
      list.push(filterFollow({ id: d.id, ...d.data() }));
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.post('/follow/users/:id', jwtAuth('write:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    const targetUserDoc = await dbRef.doc(user).get();
    if (!targetUserDoc.exists) {
      res.status(404).send('USER_NOT_FOUND');
    }
    await addFollowUser(user, id);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.delete('/follow/users/:id', jwtAuth('write:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    await dbRef
      .doc(user)
      .collection('follow')
      .doc(id)
      .set({
        isFollowed: false,
        ts: Date.now(),
      }, { merge: true });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
