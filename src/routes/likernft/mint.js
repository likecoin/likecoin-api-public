import { Router } from 'express';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { likeNFTCollection } from '../../util/firebase';
import { parseNFTInformationFromSendTxHash, writeMintedNFTInfo } from '../../util/api/likernft/mint';
import { getISCNPrefixDocName, getISCNDocByClassId } from '../../util/api/likernft';
import { getNFTsByClassId, getNFTClassIdByISCNId } from '../../util/cosmos/nft';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';
import { getISCNPrefix } from '../../util/cosmos/iscn';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../config/config';

const router = Router();

router.get(
  '/mint',
  fetchISCNIdAndClassId,
  async (_, res, next) => {
    try {
      const { classId } = res.locals;
      const doc = await getISCNDocByClassId(classId);
      const iscnNFTData = doc.data();
      if (!iscnNFTData) {
        res.sendStatus(404);
        return;
      }
      const iscnId = decodeURIComponent(doc.id);
      res.json(filterLikeNFTISCNData({ iscnId, ...doc.data() }));
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
        const info = await parseNFTInformationFromSendTxHash(txHash);
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
      } = await getNFTsByClassId(classId, LIKER_NFT_TARGET_ADDRESS);
      if (!nfts[0]) throw new ValidationError('NFT_NOT_RECEIVED');

      await writeMintedNFTInfo(iscnId, {
        classId,
        totalCount: nfts.length,
        uri: nfts[0].uri,
      }, nfts);

      res.json({
        classId,
        iscnId: getISCNPrefix(iscnId),
        nftCount: nfts.length,
        sellerWallet,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
