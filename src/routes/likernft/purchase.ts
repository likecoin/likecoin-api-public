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
import { checkFreeMintExists } from '../../util/api/likernft/free';

const API_EXPIRATION_BUFFER_TIME = 5000;

const router = Router();

router.get(
  '/purchase',
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      try {
        const { iscnPrefix, classId } = res.locals;
        const { wallet } = req.query;
        const {
          price,
          lastSoldPrice,
          ...info
        } = await getLatestNFTPriceAndInfo(iscnPrefix, classId);
        const isFree = price === 0;
        let canFreeCollect;
        if (isFree && wallet) {
          canFreeCollect = !(await checkFreeMintExists(wallet as string, classId));
        }
        const gasFee = isFree ? 0 : getGasPrice();
        res.json({
          price,
          gasFee,
          totalPrice: price + gasFee,
          lastSoldPrice,
          canFreeCollect,
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
      const { tx_hash: grantTxHash, ts, wallet } = req.query;
      const { memo: bodyMemo } = req.body;
      const { iscnPrefixes, classIds } = res.locals;
      const nftPriceInfoList = await Promise.all(
        classIds.map(async (classId, i) => {
          const {
            price: nftPrice,
          } = await getLatestNFTPriceAndInfo(iscnPrefixes[i], classId);
          if (nftPrice < 0) throw new ValidationError(`NFT_${classId}_SOLD_OUT`);
          return nftPrice;
        }),
      );
      const totalNFTPrice = nftPriceInfoList.reduce((acc, nftPrice) => acc + nftPrice, 0);
      const isFreeMint = totalNFTPrice === 0;
      const gasFee = isFreeMint ? 0 : getGasPrice();
      const totalPrice = totalNFTPrice + gasFee;

      let memo;
      let likeWallet;
      let grantedAmount;
      if (!isFreeMint) {
        if (ts && (Date.now() - Number(ts) > API_EXPIRATION_BUFFER_TIME)) throw new ValidationError('USER_TIME_OUT_SYNC');
        if (!grantTxHash) throw new ValidationError('MISSING_TX_HASH');
        const result = await checkTxGrantAndAmount(grantTxHash, totalPrice);
        if (!result) {
          throw new ValidationError('SEND_GRANT_NOT_FOUND');
        }
        ({
          memo,
          granter: likeWallet,
          spendLimit: grantedAmount,
        } = result);
      } else {
        memo = bodyMemo;
        likeWallet = wallet as string;
        grantedAmount = 0;
      }
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

      const txData = {
        buyerWallet: likeWallet,
        buyerMemo: memo,
        grantTxHash: grantTxHash as string,
        feeWallet,
      };
      const purchasedDataItems: any = [];
      purchaseInfoList.forEach((info) => {
        const purchasedData = {
          iscnId: info.iscnPrefix,
          classId: info.classId,
          nftId: info.nftId,
          nftPrice: info.nftPrice,
          gasFee: info.gasFee,
          sellerWallet: info.sellerWallet,
          sellerLIKE: info.sellerLIKE,
          sellerLIKENumber: Number(info.sellerLIKE),
          stakeholderWallets: info.stakeholderWallets,
          stakeholderLIKEs: info.stakeholderLIKEs,
          stakeholderLIKEsNumber: info.stakeholderLIKEs.map((l) => Number(l)),
          feeLIKE: info.feeLIKE,
          feeLIKENumber: Number(info.sellerLIKE),
        };
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'LikerNFTPurchaseSuccess',
          ...txData,
          ...purchasedData,
        });
        purchasedDataItems.push(purchasedData);
      });

      if (purchasedDataItems.length > 1) {
        // NOTE: Group multiple purchases into one event
        purchasedDataItems.sort((a, b) => b.nftPrice - a.nftPrice);
        publisher.publish(PUBSUB_TOPIC_WNFT, null, {
          type: 'purchase_multiple',
          ...txData,
          items: purchasedDataItems,
        });
      } else {
        publisher.publish(PUBSUB_TOPIC_WNFT, null, {
          type: 'purchase',
          ...txData,
          ...purchasedDataItems[0],
        });
      }
    } catch (err) {
      next(err);
    }
  },
);

export default router;
