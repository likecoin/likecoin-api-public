import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterFollow } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { addFollowUser } from '../../util/api/users/follow';
import { PUBSUB_TOPIC_MISC, DEFAULT_FOLLOW_IDS } from '../../constant';
import publisher from '../../util/gcloudPub';

const router = Router();

router.get('/follow/users', jwtAuth('read:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const {
      limit = 4096,
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

    const defaultPushList = [];
    if (!filter) { // check for default follow if no filter is applied
      const defaultPayload = {
        ts: Date.now(),
        isFollow: true,
      };
      DEFAULT_FOLLOW_IDS.forEach((id) => {
        if (!list.find((l => l.id === id))) {
          list.push({ id, ...defaultPayload });
          defaultPushList.push(id);
        }
      });
    }
    res.json({ list });
    if (defaultPushList && defaultPushList.length) {
      await Promise.all(defaultPushList.map(id => addFollowUser(user, id)));
    }
  } catch (err) {
    next(err);
  }
});

router.get('/follow/users/:id', jwtAuth('read:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    const doc = await dbRef
      .doc(user)
      .collection('follow')
      .doc(id)
      .get();
    if (!doc.exists) {
      res.status(404).send('NO_FOLLOW_RECORD');
      return;
    }
    res.json(filterFollow({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/follow/users/:id', jwtAuth('write:follow'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    const targetUserDoc = await dbRef.doc(id).get();
    if (!targetUserDoc.exists) {
      res.status(404).send('USER_NOT_FOUND');
      return;
    }
    await addFollowUser(user, id);
    res.sendStatus(200);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'userFollowAdd',
      user,
      follow: id,
    });
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
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'userFollowRemove',
      user,
      follow: id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
