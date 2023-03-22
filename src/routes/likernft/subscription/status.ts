import { Router } from 'express';

import { likeNFTSubscriptionUserCollection } from '../../../util/firebase';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { wallet } = req.query;
    const doc = await likeNFTSubscriptionUserCollection.doc(wallet).get();
    if (!doc.data()) {
      res.status(404).send('PAYMENT_ID_NOT_FOUND');
      return;
    }
    const { currentPeriodEnd, currentPeriodStart } = doc.data();
    const tsNow = Date.now() / 1000;
    const isActive = currentPeriodStart < tsNow && currentPeriodEnd > tsNow;
    res.json({ isActive });
  } catch (err) {
    next(err);
  }
});

export default router;
