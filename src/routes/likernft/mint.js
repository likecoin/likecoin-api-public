import { Router } from 'express';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { likeNFTCollection } from '../../util/firebase';
import {
  getISCNPrefixDocName,
  parseNFTInformationFromTxHash,
  getNFTsByClassId,
  getNFTClassIdByISCNId,
  writeMintedFTInfo,
} from '../../util/api/likernft/mint';
import { getISCNDocByClassId } from '../../util/api/likernft/metadata';

const router = Router();

router.get(
  '/mint',
  async (req, res, next) => {
    try {
      const { iscn_id: iscnId, class_id: classId } = req.query;
      if (!iscnId && !classId) throw new ValidationError('MISSING_ISCN_OR_CLASS_ID');
      let iscnNFTData;
      if (!iscnId) {
        const doc = await getISCNDocByClassId(classId);
        iscnNFTData = doc.data();
      } else {
        const iscnPrefix = getISCNPrefixDocName(iscnId);
        const likeNFTDoc = await likeNFTCollection.doc(iscnPrefix).get();
        iscnNFTData = likeNFTDoc.data();
      }
      if (!iscnNFTData) {
        res.sendStatus(404);
        return;
      }
      res.json(filterLikeNFTISCNData(iscnNFTData));
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
      if (!iscnId) throw new ValidationError('MISSING_ISCN_ID');
      const iscnPrefix = getISCNPrefixDocName(iscnId);
      const likeNFTDoc = await likeNFTCollection.doc(iscnPrefix).get();
      const likeNFTdata = likeNFTDoc.data();
      if (likeNFTdata) {
        res.sendStatus(409);
        return;
      }

      let classId = inputClassId;
      let sellerWallet;
      if (txHash) {
        const info = await parseNFTInformationFromTxHash(txHash);
        if (info) {
          const {
            classId: resClassId,
            fromWallet,
          } = info;
          if (classId && classId !== resClassId) throw new ValidationError('CLASS_ID_NOT_MATCH_TX');
          classId = resClassId;
          sellerWallet = fromWallet;
        }
      }
      if (!classId) {
        classId = await getNFTClassIdByISCNId(iscnId);
      }
      if (!classId) throw new ValidationError('CANNOT_FETCH_CLASS_ID');
      const {
        nfts,
      } = await getNFTsByClassId(classId);
      if (!nfts[0]) throw new ValidationError('NFT_NOT_RECEIVED');

      await writeMintedFTInfo(iscnId, {
        classId,
        totalCount: nfts.length,
        uri: nfts[0].uri,
      }, nfts);

      res.json({
        classId,
        iscnId,
        nftCount: nfts.length,
        sellerWallet,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
