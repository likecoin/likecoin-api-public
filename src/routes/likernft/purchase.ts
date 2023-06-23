import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import {
  getLatestNFTPriceAndInfo,
  getGasPrice,
  checkTxGrantAndAmount,
  processNFTPurchase,
} from '../../util/api/likernft/purchase';
import { fetchISCNPrefixAndClassId, fetchISCNPrefixes } from '../../middleware/likernft';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC, PUBSUB_TOPIC_WNFT } from '../../constant';

const API_EXPIRATION_BUFFER_TIME = 5000;

const router = Router();

router.get(
  '/purchase',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      try {
        const { iscnPrefix, classId } = res.locals;
        const {
          price,
          lastSoldPrice,
          ...info
        } = await getLatestNFTPriceAndInfo(iscnPrefix, classId);
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
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { tx_hash: grantTxHash, ts } = req.query;
      if (ts && (Date.now() - Number(ts) > API_EXPIRATION_BUFFER_TIME)) throw new ValidationError('USER_TIME_OUT_SYNC');
      if (!grantTxHash) throw new ValidationError('MISSING_TX_HASH');
      const { iscnPrefixes, classIds } = res.locals;
      const nftPriceInfoList = await Promise.all(
        classIds.map(async (classId, i) => {
          const {
            price: nftPrice,
          } = await getLatestNFTPriceAndInfo(iscnPrefixes[i], classId);
          if (nftPrice <= 0) throw new ValidationError(`NFT_${classId}_SOLD_OUT`);
          return nftPrice;
        }),
      );
      const totalNFTPrice = nftPriceInfoList.reduce((acc, nftPrice) => acc + nftPrice, 0);
      const gasFee = getGasPrice();
      const totalPrice = totalNFTPrice + gasFee;
      const result = await checkTxGrantAndAmount(grantTxHash, totalPrice);
      if (!result) {
        throw new ValidationError('SEND_GRANT_NOT_FOUND');
      }
      const {
        memo,
        granter: likeWallet,
        spendLimit: grantedAmount,
      } = result;
      const {
        transactionHash: txHash,
        feeWallet,
        purchaseInfoList,
      } = await processNFTPurchase({
        buyerWallet: likeWallet,
        iscnPrefixes,
        classIds,
        granterWallet: likeWallet,
        grantedAmount,
        grantTxHash: grantTxHash as string,
        granterMemo: memo,
      }, req);
      res.json({
        txHash,
        purchased: purchaseInfoList.map((info) => ({
          iscnId: info.iscnPrefix,
          classId: info.classId,
          nftId: info.nftId,
          nftPrice: info.nftPrice,
          gasFee: info.gasFee,
        })),
      });

      purchaseInfoList.forEach((info) => {
        const logPayload = {
          txHash,
          iscnId: info.iscnPrefix,
          classId: info.classId,
          nftId: info.nftId,
          nftPrice: info.nftPrice,
          gasFee: info.gasFee,
          buyerWallet: likeWallet,
          buyerMemo: memo,
          grantTxHash: grantTxHash as string,
          sellerWallet: info.sellerWallet,
          sellerLIKE: info.sellerLIKE,
          sellerLIKENumber: Number(info.sellerLIKE),
          stakeholderWallets: info.stakeholderWallets,
          stakeholderLIKEs: info.stakeholderLIKEs,
          stakeholderLIKEsNumber: info.stakeholderLIKEs.map((l) => Number(l)),
          feeWallet,
          feeLIKE: info.feeLIKE,
          feeLIKENumber: Number(info.sellerLIKE),
        };
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTPurchaseSuccess',
          ...logPayload,
        });
        publisher.publish(PUBSUB_TOPIC_WNFT, null, {
          type: 'purchase',
          ...logPayload,
        });
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
