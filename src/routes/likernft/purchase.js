import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import {
  getLatestNFTPriceAndInfo,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';
import { getISCNPrefix } from '../../util/cosmos/iscn';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';

const router = Router();

router.get(
  '/purchase',
  fetchISCNIdAndClassId,
  async (_, res, next) => {
    try {
      try {
        const { iscnId, classId } = res.locals;
        const { price, lastSoldPrice, ...info } = await getLatestNFTPriceAndInfo(iscnId, classId);
        const gasFee = getGasPrice();
        res.json({
          price,
          gasFee,
          totalPrice: price + gasFee,
          lastSoldPrice,
          metadata: filterLikeNFTISCNData({
            ...info,
            iscnId: getISCNPrefix(iscnId),
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
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const { iscnId, classId } = res.locals;
      const { price: nftPrice } = await getLatestNFTPriceAndInfo(iscnId, classId);
      if (nftPrice <= 0) throw new ValidationError('NFT_SOLD_OUT');
      const gasFee = getGasPrice();
      const totalPrice = nftPrice + gasFee;
      const result = await checkTxGrantAndAmount(txHash, totalPrice);
      if (!result) {
        throw new ValidationError('SEND_GRANT_NOT_FOUND');
      }
      const {
        granter: likeWallet,
        spendLimit: grantedAmount,
      } = result;
      const {
        transactionHash,
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
      } = await processNFTPurchase(likeWallet, iscnId, classId, grantedAmount);
      res.json({
        txHash: transactionHash,
        iscnId: getISCNPrefix(iscnId),
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
