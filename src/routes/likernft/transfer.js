import { Router } from 'express';

import { ValidationError } from '../../util/ValidationError';
import { getISCNIdByClassId } from '../../util/api/likernft';
import { getNFTTransferInfo, processNFTTransfer } from '../../util/api/likernft/transfer';

const router = Router();

router.post(
  '/transfer',
  async (req, res, next) => {
    try {
      const { tx_hash: txHash, nft_id: nftId } = req.query;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const info = await getNFTTransferInfo(txHash, nftId);
      if (!info) throw new ValidationError('NO_MATCHING_TX_HASH_AND_NFT_ID');
      const {
        fromAddress,
        toAddress,
        classId,
        txTimestamp,
      } = info;
      const iscnId = await getISCNIdByClassId(classId);
      await processNFTTransfer({
        newOwnerAddress: toAddress,
        iscnId,
        classId,
        nftId,
        txTimestamp,
      });
      res.json({
        txTimestamp,
        txHash,
        iscnId,
        classId,
        nftId,
        fromAddress,
        toAddress,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
