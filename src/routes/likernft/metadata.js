import { Router } from 'express';
import { likeNFTCollection } from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTMetadata } from '../../util/ValidationHelper';
import { getISCNPrefixDocName } from '../../util/api/likernft/mint';

const router = Router();

router.get(
  '/metadata',
  async (req, res, next) => {
    try {
      const {
        iscn_id: iscnId,
        class_id: classId,
        // nft_id: nftId, // not used since all nft in a class use same metadata
      } = req.query;
      if (!classId && !iscnId) {
        throw new ValidationError('PLEASE_DEFINE_QUERY_ID');
      }
      let classData;
      if (iscnId) {
        let classDocRef;
        if (!classId) {
          const iscnPrefix = getISCNPrefixDocName(iscnId);
          const iscnDoc = await likeNFTCollection.doc(iscnPrefix).get();
          const iscnData = iscnDoc.data();
          if (!iscnData || !iscnData.classId) {
            res.status(404).send('ISCN_NFT_NOT_FOUND');
            return;
          }
          classDocRef = likeNFTCollection.doc(iscnPrefix).collection('class').doc(iscnData.classId);
        } else {
          const iscnPrefix = getISCNPrefixDocName(iscnId);
          classDocRef = likeNFTCollection.doc(iscnPrefix).collection('class').doc(classId);
        }
        classData = await classDocRef.get();
      } else {
        const query = await likeNFTCollection.collectionGroup('class').where('id', '==', classId).limit(1).get();
        if (!query.docs.length) {
          res.status(404).send('NFT_CLASS_NOT_FOUND');
          return;
        }
        classData = query.docs[0].data();
      }
      if (!classData) {
        res.status(404).send('NFT_DATA_NOT_FOUND');
        return;
      }
      // TODO: mutate metadata according to nft sale and price status
      res.json(filterLikeNFTMetadata(classData.metadata));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
