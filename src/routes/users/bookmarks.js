import { Router } from 'express';
import { userCollection as dbRef } from '../../util/firebase';
import { filterBookmarks } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';
import { addUrlToMetadataCrawler } from '../../util/api/users/bookmarks';

const uuidv4 = require('uuid/v4');
const urlParse = require('url-parse');

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

      const { user } = req.user;
      let doc;
      if (url) {
        try {
          urlParse(url);
        } catch (err) {
          res.status(400).send('INVALID_URL');
          return;
        }
        const qs = await dbRef
          .doc(user)
          .collection('bookmarks')
          .where('url', '==', url)
          .limit(1)
          .get();
        [doc] = qs.docs;
      } else {
        doc = await dbRef
          .doc(user)
          .collection('bookmarks')
          .doc(bookmarkID)
          .get();
      }
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
      const query = await dbRef
        .doc(user)
        .collection('bookmarks')
        .orderBy('ts', 'desc')
        .get();
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
        ts: Date.now(),
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

    let targetRef;
    if (url) {
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
      if (!query.docs || !query.docs.length) {
        res.status(404).send('BOOKMARK_NOT_FOUND');
        return;
      }
      targetRef = query.docs[0].ref;
    } else {
      const bookmarkRef = dbRef
        .doc(user)
        .collection('bookmarks')
        .doc(bookmarkID);
      const bookmarkDoc = await bookmarkRef.get();
      if (!bookmarkDoc.exists) {
        res.status(404).send('BOOKMARK_NOT_FOUND');
        return;
      }
      targetRef = bookmarkRef;
    }
    await targetRef.delete();
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});


export default router;
