import { Router } from 'express';
import { likeNFTCollection } from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import { getISCNPrefixDocName } from '../../util/api/likernft/mint';
import { getISCNDocByClassID } from '../../util/api/likernft/metadata';

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
        const doc = await getISCNDocByClassID(classId);
        const queryObj = await doc.ref('transaction')
          .where('classId', '==', classId);
        if (nftId) queryObj.where('nftId', '==', nftId);
        const query = await queryObj.orderBy('timestamp', 'desc').get();
        list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      } else if (iscnId) {
        const iscnPrefix = getISCNPrefixDocName(iscnId);
        const query = await likeNFTCollection.doc(iscnPrefix)
          .collection('transaction').orderBy('timestamp', 'desc').get();
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
