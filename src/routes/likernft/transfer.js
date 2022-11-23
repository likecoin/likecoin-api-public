import { Router } from 'express';

import { ValidationError } from '../../util/ValidationError';
import { getISCNPrefixByClassId } from '../../util/api/likernft';
import { getNFTTransferInfo, processNFTTransfer } from '../../util/api/likernft/transfer';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const router = Router();

router.post(
  '/transfer',
  async (req, res, next) => {
    try {
      const {
        tx_hash: txHash,
        class_id: classId,
        nft_id: nftId,
      } = req.query;
      if (!txHash || !classId || !nftId) throw new ValidationError('MISSING_TX_HASH_CLASS_ID_OR_NFT_ID');
      const info = await getNFTTransferInfo(txHash, classId, nftId);
      if (!info) throw new ValidationError('NO_MATCHING_TX_HASH_AND_NFT_ID');
      const {
        code,
        fromAddress,
        toAddress,
        txTimestamp,
      } = info;
      if (code) throw new ValidationError(`TX_FAILED_WITH_CODE_${code}`);
      const iscnPrefix = await getISCNPrefixByClassId(classId);
      await processNFTTransfer({
        fromAddress,
        toAddress,
        iscnPrefix,
        classId,
        nftId,
        txHash,
        txTimestamp,
      });
      res.json({
        txTimestamp,
        txHash,
        iscnId: iscnPrefix,
        classId,
        nftId,
        fromAddress,
        toAddress,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTTransfer',
        classId,
        iscnId: iscnPrefix,
        nftId,
        txHash,
        timestamp: txTimestamp,
        fromAddress,
        toAddress,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
