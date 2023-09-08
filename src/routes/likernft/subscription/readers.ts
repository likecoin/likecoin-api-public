import { Router } from 'express';
import { getSubscriberCanCollectNFT, getSubscriptionUserActiveSubscriptionsData } from '../../../util/api/likernft/subscription/readers';
import { jwtAuth } from '../../../middleware/jwt';
import { fetchISCNPrefixAndClassId } from '../../../middleware/likernft';
import { ValidationError } from '../../../util/ValidationError';
import publisher from '../../../util/gcloudPub';
import { processNFTPurchase } from '../../../util/api/likernft/purchase';
import { PUBSUB_TOPIC_MISC, PUBSUB_TOPIC_WNFT } from '../../../constant';

const router = Router();

router.get(
  '/plans',
  jwtAuth('read:nft_reader'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const plans = await getSubscriptionUserActiveSubscriptionsData(wallet);
      res.json({ plans });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/nft/purchase',
  jwtAuth('read:nft_reader'),
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      const { classId } = res.locals;
      const { wallet } = req.user;
      const {
        collectExpiryAt,
        canFreeCollect,
        hasFreeCollected,
      } = await getSubscriberCanCollectNFT(wallet, classId);
      res.json({ canFreeCollect, collectExpiryAt, hasFreeCollected });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nft/purchase',
  jwtAuth('write:nft_reader'),
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      const { iscnPrefix, classId } = res.locals;
      const { wallet } = req.user;
      const { memo: bodyMemo } = req.body;

      const {
        isSubscriber,
        isFreeForSubscribers,
        isExpired,
        canFreeCollect,
        hasFreeCollected,
      } = await getSubscriberCanCollectNFT(wallet, classId);
      if (!isFreeForSubscribers) {
        throw new ValidationError('NOT_FREE_FOR_SUBSCRIBER');
      }
      if (!isSubscriber) {
        throw new ValidationError('NOT_SUBSCRIBED');
      }
      if (hasFreeCollected) {
        throw new ValidationError('ALREADY_COLLECTED');
      }
      if (isExpired) {
        throw new ValidationError('COLLECT_DATE_EXPIRED');
      }
      if (!canFreeCollect) {
        throw new ValidationError('CANNOT_COLLECT');
      }
      const memo = bodyMemo;
      const likeWallet = wallet;
      const grantedAmount = 0;
      const grantTxHash = '';
      const isSubscriberFreeCollect = true;
      const {
        transactionHash: txHash,
        feeWallet,
        purchaseInfoList,
      } = await processNFTPurchase({
        buyerWallet: likeWallet,
        iscnPrefixes: [iscnPrefix],
        classIds: [classId],
        isSubscriberFreeCollect,
        granterWallet: '',
        grantedAmount,
        grantTxHash,
        granterMemo: memo,
      }, req);
      res.json({
        txHash,
        purchased: purchaseInfoList.map((info) => ({
          iscnId: info.iscnPrefix,
          classId: info.classId,
          nftId: info.nftId,
          nftPrice: info.nftPrice,
          originalNftPrice: info.originalNftPrice,
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
          originalNftPrice: info.originalNftPrice,
          gasFee: info.gasFee,
          sellerWallet: info.sellerWallet,
          sellerLIKE: info.sellerLIKE,
          sellerLIKENumber: Number(info.sellerLIKE),
          stakeholderWallets: info.stakeholderWallets,
          stakeholderLIKEs: info.stakeholderLIKEs,
          stakeholderLIKEsNumber: info.stakeholderLIKEs.map((l) => Number(l)),
          feeLIKE: info.feeLIKE,
          feeLIKENumber: Number(info.sellerLIKE),
          isSubscriberFreeCollect,
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
