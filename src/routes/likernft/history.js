import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { getISCNDocByClassId } from '../../util/api/likernft';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';

const router = Router();

router.get(
  '/history',
  fetchISCNIdAndClassId,
  async (req, res, next) => {
    try {
      const { nft_id: nftId } = req.query;
      const { classId } = res.locals;
      if (nftId && !classId) {
        throw new ValidationError('PLEASE_DEFINE_CLASS_ID');
      }
      let list = [];
      const doc = await getISCNDocByClassId(classId);
      let queryObj = await doc.ref.collection('transaction');
      if (nftId) queryObj = queryObj.where('nftId', '==', nftId);
      const query = await queryObj.orderBy('timestamp', 'desc').get();
      list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      res.json({
        list,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
