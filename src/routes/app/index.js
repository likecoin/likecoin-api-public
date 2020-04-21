import { Router } from 'express';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { filterAppMeta } from '../../util/ValidationHelper';
import { jwtAuth } from '../../middleware/jwt';

const router = Router();

router.get('/meta', jwtAuth('read'), async (req, res, next) => {
  try {
    const { user } = req.user;
    const doc = await dbRef.doc(user).collection('app').doc('meta').get();
    res.json(filterAppMeta(doc.data() || {}));
  } catch (err) {
    next(err);
  }
});

export default router;
