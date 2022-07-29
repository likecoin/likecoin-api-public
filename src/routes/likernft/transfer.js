import { Router } from 'express';
import axios from 'axios';

import { ValidationError } from '../../util/ValidationError';
import { getISCNIdByClassId } from '../../util/api/likernft';
import { processNFTTransfer } from '../../util/api/likernft/transfer';

import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../config/config';

const router = Router();

router.post(
  '/transfer',
  async (req, res, next) => {
    try {
      const { tx_hash: txHash } = req.query;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs/${txHash}`);
      const {
        class_id: classId,
        id: nftId,
        sender,
        receiver,
      } = data.tx.body.messages[0];
      const iscnId = await getISCNIdByClassId(classId);
      const { timestamp: txTimestamp } = data.tx_response;
      await processNFTTransfer({
        newOwnerAddress: receiver,
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
        fromAddress: sender,
        toAddress: receiver,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
