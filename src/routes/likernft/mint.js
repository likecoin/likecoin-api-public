import { Router } from 'express';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { likeNFTCollection } from '../../util/firebase';
import { getISCNPrefix } from '../../util/cosmos/iscn';
import { parseNFTInformationFromTxHash, getNFTsByClassId, writeMintedFTInfo } from '../../util/api/likernft/mint';

const router = Router();

router.get(
  '/mint',
  (req, res, next) => {
    try {
      const { iscn_id: iscnId } = req.query;
      const iscnPrefix = getISCNPrefix(iscnId);
      const likeNFTDoc = likeNFTCollection.doc(iscnPrefix).get();
      const data = likeNFTDoc.data();
      if (data) {
        res.sendStatus(404);
        return;
      }
      res.json(filterLikeNFTISCNData(data));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/mint',
  async (req, res, next) => {
    try {
      const {
        iscn_id: iscnId,
        tx_hash: txHash,
        class_id: inputClassId,
      } = req.query;
      if (!iscnId && !inputClassId) throw ValidationError('MISSING_CLASS_OR_ISCN_ID');
      const iscnPrefix = getISCNPrefix(iscnId);
      const likeNFTDoc = likeNFTCollection.doc(iscnPrefix).get();
      if (likeNFTDoc) {
        res.sendStatus(409);
        return;
      }

      let classId = inputClassId;
      if (txHash) {
        const {
          classId: resClassId,
        } = await parseNFTInformationFromTxHash(txHash);
        if (classId && classId !== resClassId) throw ValidationError('CLASS_ID_NOT_MATCH_TX');
        classId = resClassId;
      }
      const {
        total,
        nfts,
      } = await getNFTsByClassId(classId);
      if (!total || !nfts[0]) throw ValidationError('NFT_NOT_RECEIVED');

      await writeMintedFTInfo({
        classId,
        totalCount: total,
        uri: nfts[0].uri,
      }, nfts);

      res.json();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
