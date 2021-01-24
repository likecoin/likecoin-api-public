import { Router } from 'express';
import { txCollection as txLogRef } from '../../util/firebase';
import { filterMultipleTxData } from '../../util/api/tx';
import { filterTxData } from '../../util/ValidationHelper';

const router = Router();

router.get('/id/:id', async (req, res, next) => {
  try {
    const { id: txHash } = req.params;
    const { address } = req.query;
    const doc = await txLogRef.doc(txHash).get();
    if (doc.exists) {
      const payload = doc.data().toIds
        ? filterMultipleTxData(doc.data(), { to: { addresses: address ? [address] : null } })
        : doc.data();
      res.json(filterTxData(payload));
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

export default router;
