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
      const { tx_hash: txHash, nft_id: nftId } = req.query;
      if (!txHash || !nftId) throw new ValidationError('MISSING_TX_HASH_OR_NFT_ID');
      const info = await getNFTTransferInfo(txHash, nftId);
      if (!info) throw new ValidationError('NO_MATCHING_TX_HASH_AND_NFT_ID');
      const {
        fromAddress,
        toAddress,
        classId,
        txTimestamp,
      } = info;
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
