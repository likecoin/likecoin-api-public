import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterBookmarks } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { addUrlToMetadataCrawler } from '../../util/api/users/bookmarks';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import publisher from '../../util/gcloudPub';

const uuidv4 = require('uuid/v4');
const urlParse = require('url-parse');

async function queryBookmark(user, { bookmarkID, url }) {
  let doc;
  if (url) {
    const qs = await dbRef
      .doc(user)
      .collection('bookmarks')
      .where('url', '==', url)
      .limit(1)
      .get();
    [doc] = qs.docs;
  } else if (bookmarkID) {
    doc = await dbRef
      .doc(user)
      .collection('bookmarks')
      .doc(bookmarkID)
      .get();
  }
  return doc;
}

const router = Router();

router.get('/bookmarks/:id?', jwtAuth('read:bookmarks'),
  /**
   * Handle `/bookmarks/:id` or `/bookmarks?url=`
   */
  async (req, res, next) => {
    try {
      const bookmarkID = req.params.id;
      const url = req.body.url || req.query.url;
      if (url && bookmarkID) {
        res.status(400).send('URL_AND_ID_COEXIST');
        return;
      }
      if (!url && !bookmarkID) {
        next();
        return;
      }
      try {
        urlParse(url);
      } catch (err) {
        res.status(400).send('INVALID_URL');
        return;
      }
      const { user } = req.user;
      const doc = await queryBookmark(user, { bookmarkID, url });
      if (!doc || !doc.exists) {
        res.status(404).send('BOOKMARK_NOT_FOUND');
        return;
      }

      res.json(filterBookmarks({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (err) {
      next(err);
    }
  },
  /**
   * Handle `/bookmarks`
   */
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const { archived = '0' } = req.query;
      let query = dbRef
        .doc(user)
        .collection('bookmarks');
      if (archived === '0') {
        query = query.where('isArchived', '==', false);
      } else if (archived === '1') {
        query = query.where('isArchived', '==', true);
      }
      query = await query.orderBy('ts', 'desc').get();
      const list = [];
      query.docs.forEach((d) => {
        list.push(filterBookmarks({ id: d.id, ...d.data() }));
      });
      res.json({ list });
    } catch (err) {
      next(err);
    }
  });

router.post('/bookmarks', jwtAuth('write:bookmarks'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const url = req.body.url || req.query.url;
    if (!url) {
      res.status(400).send('MISSING_URL');
      return;
    }
    try {
      urlParse(url);
    } catch (err) {
      res.status(400).send('INVALID_URL');
      return;
    }
    const query = await dbRef
      .doc(user)
      .collection('bookmarks')
      .where('url', '==', url)
      .limit(1)
      .get();
    if (query.docs.length) {
      res.status(409).send('BOOKMARK_ALREADY_EXISTS');
      return;
    }
    const bookmarkID = uuidv4();
    await dbRef
      .doc(user)
      .collection('bookmarks')
      .doc(bookmarkID)
      .create({
        isArchived: false,
        ts: Date.now(),
        url,
      });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'userBookmarkAdd',
      user,
      url,
    });
    res.json({
      id: bookmarkID,
    });
    await addUrlToMetadataCrawler(url);
  } catch (err) {
    next(err);
  }
});

router.post('/bookmarks/:id/archive', jwtAuth('write:bookmarks'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    await dbRef
      .doc(user)
      .collection('bookmarks')
      .doc(id)
      .update({ isArchived: true });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.delete('/bookmarks/:id?', jwtAuth('write:bookmarks'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const bookmarkID = req.params.id;
    const url = req.body.url || req.query.url;
    if (!url && !bookmarkID) {
      res.status(400).send('MISSING_BOOKMARK');
      return;
    }
    if (url && bookmarkID) {
      res.status(400).send('URL_AND_ID_COEXIST');
      return;
    }
    if (url) {
      try {
        urlParse(url);
      } catch (err) {
        res.status(400).send('INVALID_URL');
        return;
      }
    }
    const targetDoc = queryBookmark(user, { bookmarkID, url });
    if (!targetDoc || !targetDoc.exists) {
      res.status(404).send('BOOKMARK_NOT_FOUND');
      return;
    }
    const targetRef = targetDoc.ref;
    await targetRef.delete();
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'userBookmarkRemove',
      user,
      url,
    });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});


export default router;
