import { Router } from 'express';
import RateLimit from 'express-rate-limit';

import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { likeNFTCollection } from '../../util/firebase';
import { parseNFTInformationFromSendTxHash, writeMintedNFTInfo } from '../../util/api/likernft/mint';
import { getISCNPrefixDocName, getISCNDocByClassId } from '../../util/api/likernft';
import {
  getNFTClassDataById,
  getNFTsByClassId,
  getNFTClassIdByISCNId,
} from '../../util/cosmos/nft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import { getISCNPrefix } from '../../util/cosmos/iscn';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC, PUBSUB_TOPIC_WNFT } from '../../constant';
import {
  LIKER_NFT_TARGET_ADDRESS,
  LIKER_NFT_MINT_MIN_BATCH,
} from '../../../config/config';

const router = Router();

router.get(
  '/mint',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId } = res.locals;
      const doc = await getISCNDocByClassId(classId);
      const iscnNFTData = doc.data();
      if (!iscnNFTData) {
        res.sendStatus(404);
        return;
      }
      const iscnPrefix = decodeURIComponent(doc.id);
      res.json(filterLikeNFTISCNData({ iscnId: iscnPrefix, ...doc.data() }));
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
        platform = '',
      } = req.query;
      const {
        contentUrl,
        reservedNftCount,
        initialBatch,
        isFree,
        collectExpiryAt,
      } = req.body;

      if (isFree && initialBatch && initialBatch > -1) throw new ValidationError('CANNOT_SET_BOTH_FREE_AND_INITIAL_BATCH');
      // guard for USD base
      if (
        // free mint
        initialBatch !== -1
        && initialBatch < LIKER_NFT_MINT_MIN_BATCH
      ) throw new ValidationError(`INITIAL_BATCH_CANNOT_BE_LESS_THAN_${LIKER_NFT_MINT_MIN_BATCH}_IF_NOT_FREE`);
      if (!iscnId) throw new ValidationError('MISSING_ISCN_ID');
      if (collectExpiryAt && collectExpiryAt < Date.now()) throw new ValidationError('COLLECT_EXPIRY_AT_CANNOT_BE_IN_THE_PAST');

      const iscnPrefix = getISCNPrefix(iscnId);
      const iscnPrefixDocName = getISCNPrefixDocName(iscnId);
      const likeNFTDoc = await likeNFTCollection.doc(iscnPrefixDocName).get();
      const likeNFTdata = likeNFTDoc.data();
      if (likeNFTdata) {
        res.sendStatus(409);
        return;
      }

      let classId = inputClassId;
      if (txHash) {
        const info = await parseNFTInformationFromSendTxHash(txHash);
        if (info) {
          const {
            classId: resClassId,
          } = info;
          if (classId && classId !== resClassId) throw new ValidationError('CLASS_ID_NOT_MATCH_TX');
          classId = resClassId;
        }
      }
      if (!classId) {
        classId = await getNFTClassIdByISCNId(iscnId);
      }
      if (!classId) throw new ValidationError('CANNOT_FETCH_CLASS_ID');
      const [
        { nfts },
        chainClassData,
      ] = await Promise.all([
        getNFTsByClassId(classId, LIKER_NFT_TARGET_ADDRESS),
        getNFTClassDataById(classId),
      ]);
      if (!chainClassData) throw new ValidationError('NFT_CLASS_ID_NOT_FOUND');
      if (!nfts[0]) throw new ValidationError('NFT_NOT_RECEIVED');
      const {
        name,
        description,
        uri,
        data: { parent, metadata: classMetadata = {} } = {},
      } = chainClassData;
      const chainMetadata = {
        metadata: classMetadata,
        name,
        description,
        uri,
        parent,
      };
      const { sellerWallet, basePrice } = await writeMintedNFTInfo(iscnPrefix, {
        ...chainMetadata,
        initialBatch,
        isFree,
        collectExpiryAt,
        classId,
        totalCount: nfts.length,
        platform,
      }, nfts);

      res.json({
        classId,
        iscnId: iscnPrefix,
        nftCount: nfts.length,
        sellerWallet,
      });

      const logPayload = {
        classId,
        iscnId: iscnPrefix,
        txHash,
        reservedNftCount,
        nftCount: nfts.length,
        sellerWallet,
        apiWallet: LIKER_NFT_TARGET_ADDRESS,
        uri,
        platform,
        contentUrl,
        initialBatch,
        isFree,
        collectExpiryAt,
        basePrice,
      };

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTMint',
        ...logPayload,
      });
      publisher.publish(PUBSUB_TOPIC_WNFT, null, {
        type: 'mint',
        ...logPayload,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
