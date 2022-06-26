import { Router } from 'express';
import { likeNFTCollection } from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import { getISCNPrefixDocName, getISCNDocByClassId } from '../../util/api/likernft';

const router = Router();

router.get(
  '/history',
  async (req, res, next) => {
    try {
      const { class_id: classId, nft_id: nftId, iscn_id: iscnId } = req.query;
      if (nftId && !classId) {
        throw new ValidationError('PLEASE_DEFINE_CLASS_ID');
      }
      if (!classId && !iscnId) {
        throw new ValidationError('PLEASE_DEFINE_ISCN_OR_CLASS_ID');
      }
      let list = [];
      if (classId) {
        const doc = await getISCNDocByClassId(classId);
        let queryObj = await doc.ref.collection('transaction');
        if (nftId) queryObj = queryObj.where('nftId', '==', nftId);
        const query = await queryObj.orderBy('timestamp', 'desc').get();
        list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      } else if (iscnId) {
        const iscnPrefix = getISCNPrefixDocName(iscnId);
        let queryObj = likeNFTCollection.doc(iscnPrefix).collection('transaction');
        if (nftId) queryObj = queryObj.where('nftId', '==', nftId);
        const query = queryObj.orderBy('timestamp', 'desc').get();
        list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      }
      res.json({
        list,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
