import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import {
  getLatestNFTPriceAndInfo,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const API_EXPIRATION_BUFFER_TIME = 5000;

const router = Router();

router.get(
  '/purchase',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      try {
        const { iscnPrefix, classId } = res.locals;
        const { price, lastSoldPrice, ...info } = await getLatestNFTPriceAndInfo(
          iscnPrefix, classId,
        );
        const gasFee = getGasPrice();
        res.json({
          price,
          gasFee,
          totalPrice: price + gasFee,
          lastSoldPrice,
          metadata: filterLikeNFTISCNData({
            ...info,
            iscnId: iscnPrefix,
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
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      const { tx_hash: txHash, ts } = req.query;
      if (ts && (Date.now() - ts > API_EXPIRATION_BUFFER_TIME)) throw new ValidationError('USER_TIME_OUT_SYNC');
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const { iscnPrefix, classId } = res.locals;
      const { price: nftPrice } = await getLatestNFTPriceAndInfo(iscnPrefix, classId);
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
        sellerWallet,
        sellerLIKE,
        stakeholderWallets,
        stakeholderLIKEs,
        feeWallet,
        feeLIKE,
      } = await processNFTPurchase(likeWallet, iscnPrefix, classId, grantedAmount, req);
      res.json({
        txHash: transactionHash,
        iscnId: iscnPrefix,
        classId,
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTPurchaseSuccess',
        txHash: transactionHash,
        iscnId: iscnPrefix,
        classId,
        nftId,
        nftPrice: actualNftPrice,
        gasFee: actualGasFee,
        buyerWallet: likeWallet,
        sellerWallet,
        sellerLIKE,
        sellerLIKENumber: Number(sellerLIKE),
        stakeholderWallets,
        stakeholderLIKEs,
        stakeholderLIKEsNumber: stakeholderLIKEs.map(l => Number(l)),
        feeWallet,
        feeLIKE,
        feeLIKENumber: Number(sellerLIKE),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
