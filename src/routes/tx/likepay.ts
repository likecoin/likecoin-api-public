import { Router } from 'express';
import { txCollection as txLogRef } from '../../util/firebase';
import { decodeLikePayId } from '../../util/api/tx';
import { ValidationError } from '../../util/ValidationError';
import {
  filterTxData,
} from '../../util/ValidationHelper';

const router = Router();

router.get('/likepay/:txId', async (req, res, next) => {
  try {
    const { txId } = req.params;
    let address;
    let amount;
    let uuid;
    try {
      ({
        address,
        bigAmount: amount,
        uuid,
      } = decodeLikePayId(txId));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      throw new ValidationError('PAYLOAD_PARSE_FAILED');
    }
    if (!address || !amount || !uuid) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    const dataTo = await txLogRef
      .where('to', '==', address)
      .where('amount.amount', '==', amount)
      .where('remarks', '==', uuid)
      .orderBy('ts', 'desc')
      .get();
    const results = dataTo.docs.map(d => ({ id: d.id, ...filterTxData(d.data()) }));
    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
