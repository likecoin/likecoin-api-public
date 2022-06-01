import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import {
  getLatestNFTPrice,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';

const router = Router();

router.get(
  '/purchase',
  async (req, res, next) => {
    try {
      try {
        const { iscn_id: iscnId } = req.query;
        if (!iscnId) throw new ValidationError('MISSING_ISCN_ID');
        const price = await getLatestNFTPrice(iscnId);
        const gasFee = getGasPrice();
        res.json({
          price,
          gasFee,
          total: price + gasFee,
        });
      } catch (err) {
        next(err);
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/purchase',
  async (req, res, next) => {
    try {
      const { tx_hash: txHash, iscn_id: iscnId } = req.query;
      if (!txHash || !iscnId) throw new ValidationError('MISSING_TX_HASH_OR_ISCN_ID');
      const nftPrice = await getLatestNFTPrice(iscnId);
      const gasFee = getGasPrice();
      const totalPrice = nftPrice + gasFee;
      const result = await checkTxGrantAndAmount(txHash, totalPrice);
      if (!result) {
        throw new ValidationError('SEND_GRANT_NOT_FOUND');
      }
      const {
        granter: likeWallet,
      } = result;
      const {
        transactionHash,
        classId,
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
      } = await processNFTPurchase(likeWallet, iscnId);
      res.json({
        txHash: transactionHash,
        classId,
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
