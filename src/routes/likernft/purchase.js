import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import {
  getLatestNFTPriceAndInfo,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';

const router = Router();

router.get(
  '/purchase',
  fetchISCNIdAndClassId,
  async (_, res, next) => {
    try {
      try {
        const { iscnId, classId } = res.locals;
        const { price, ...info } = await getLatestNFTPriceAndInfo(iscnId, classId);
        const gasFee = getGasPrice();
        res.json({
          price,
          gasFee,
          totalPrice: price + gasFee,
          metadata: filterLikeNFTISCNData({
            ...info,
            iscnId,
          }),
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
  fetchISCNIdAndClassId,
  async (req, res, next) => {
    try {
      const { tx_hash: txHash } = req.query;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH_OR_ISCN_ID');
      const { iscnId, classId } = res.locals;
      const { price: nftPrice } = await getLatestNFTPriceAndInfo(iscnId, classId);
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
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
      } = await processNFTPurchase(likeWallet, iscnId, classId);
      res.json({
        txHash: transactionHash,
        iscnId,
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
