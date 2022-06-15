import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import {
  getLatestNFTPriceAndInfo,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';
import { getISCNDocByClassId, getCurrentClassIdByISCNId } from '../../util/api/likernft/metadata';

const router = Router();

router.get(
  '/purchase',
  async (req, res, next) => {
    try {
      try {
        const { iscn_id: inputIscnId, class_id: inputClassId } = req.query;
        if (!inputIscnId && !inputClassId) throw new ValidationError('MISSING_ISCN_OR_CLASS_ID');
        let iscnId = inputIscnId;
        let classId = inputClassId;
        if (!iscnId) {
          const doc = await getISCNDocByClassId(inputClassId);
          iscnId = doc.id;
        }
        if (!classId) {
          classId = await getCurrentClassIdByISCNId(inputIscnId);
        }
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
  async (req, res, next) => {
    try {
      const { tx_hash: txHash, iscn_id: inputIscnId, class_id: inputClassId } = req.query;
      if (!txHash || (!inputIscnId && !inputClassId)) throw new ValidationError('MISSING_TX_HASH_OR_ISCN_ID');
      let iscnId = inputIscnId;
      let classId = inputClassId;
      if (!iscnId) {
        const doc = await getISCNDocByClassId(inputClassId);
        iscnId = doc.id;
      }
      if (!classId) {
        classId = await getCurrentClassIdByISCNId(inputIscnId);
      }
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
