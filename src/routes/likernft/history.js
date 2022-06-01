import { Router } from 'express';
import { likeNFTCollection } from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

router.get(
  '/history',
  async (req, res, next) => {
    try {
      const { class_id: classId, nft_id: nftId, iscn_id: iscnId } = req.query;
      if (!nftId && !classId && !iscnId) {
        throw new ValidationError('PLEASE_DEFINE_QUERY_ID');
      }
      let list;
      if (nftId) {
        const query = await likeNFTCollection.collectionGroup('transaction')
          .where('nftId', '==', nftId).orderBy('timestamp', 'desc').get();
        list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      } else if (classId) {
        const query = await likeNFTCollection.collectionGroup('transaction')
          .where('classId', '==', classId).orderBy('timestamp', 'desc').get();
        list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
      } else if (iscnId) {
        const query = await likeNFTCollection.doc(iscnId)
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
