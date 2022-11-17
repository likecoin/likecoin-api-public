import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterBookmarks } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { addUrlToMetadataCrawler, removeQueryStringFromBookmarkUrl } from '../../util/api/users/bookmarks';
import { PUBSUB_TOPIC_MISC, API_DEFAULT_SIZE_LIMIT } from '../../constant';
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

async function updateArchiveState(user, bookmarkID, value) {
  return dbRef
    .doc(user)
    .collection('bookmarks')
    .doc(bookmarkID)
    .update({ isArchived: value });
}

const router = Router();

router.get('/bookmarks/:id?', jwtAuth('read:bookmarks'),
  /**
   * Handle `/bookmarks/:id` or `/bookmarks?url=`
   */
  async (req, res, next) => {
    try {
      const bookmarkID = req.params.id;
      const inputUrl = req.body.url || req.query.url;
      if (inputUrl && bookmarkID) {
        res.status(400).send('URL_AND_ID_COEXIST');
        return;
      }
      if (!inputUrl && !bookmarkID) {
        next();
        return;
      }
      let url = inputUrl;
      if (inputUrl) {
        try {
          urlParse(inputUrl);
          url = removeQueryStringFromBookmarkUrl(inputUrl);
        } catch (err) {
          res.status(400).send('INVALID_URL');
          return;
        }
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
      const { before, after, limit } = req.query;
      let queryRef = dbRef
        .doc(user)
        .collection('bookmarks');
      if (archived === '0') {
        // TODO: old bookmark does not include this field,
        // making them not included in this query result
        // Should use isArchived query after data is clean
        // query = query.where('isArchived', '==', false);
      } else if (archived === '1') {
        queryRef = queryRef.where('isArchived', '==', true);
      }
      queryRef = queryRef.orderBy('ts', 'desc');
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
      const query = await queryRef.limit(limit || API_DEFAULT_SIZE_LIMIT).get();
      let list: any[] = [];
      query.docs.forEach((d) => {
        list.push(filterBookmarks({ id: d.id, ...d.data() }));
      });
      if (archived === '0') list = list.filter(b => !b.isArchived);
      res.json({ list });
    } catch (err) {
      next(err);
    }
  });

router.post('/bookmarks', jwtAuth('write:bookmarks'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const inputUrl = req.body.url || req.query.url;
    if (!inputUrl) {
      res.status(400).send('MISSING_URL');
      return;
    }
    try {
      urlParse(inputUrl);
    } catch (err) {
      res.status(400).send('INVALID_URL');
      return;
    }
    const url = removeQueryStringFromBookmarkUrl(inputUrl);
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
        originalUrl: inputUrl,
      });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'userBookmarkAdd',
      user,
      url,
      originalUrl: inputUrl,
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
    await updateArchiveState(user, id, true);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.delete('/bookmarks/:id/archive', jwtAuth('write:bookmarks'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { id } = req.params;
    await updateArchiveState(user, id, false);
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
    const targetDoc = await queryBookmark(user, { bookmarkID, url });
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
