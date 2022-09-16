import { Router } from 'express';
import { ValidationError } from '../../util/ValidationError';
import { getNFTTransferInfo } from '../../util/api/likernft/transfer';
import { updateSellNFTInfo } from '../../util/api/likernft/sell';
import { getISCNPrefixByClassId } from '../../util/api/likernft';
import { getNFTOwner } from '../../util/cosmos/nft';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../config/config';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const router = Router();

router.post(
  '/sell',
  async (req, res, next) => {
    try {
      const {
        tx_hash: txHash,
        class_id: classId,
        nft_id: nftId,
        price: priceString,
      } = req.query;

      if (!classId || !nftId) throw new ValidationError('MISSING_NFT_ID');
      if (!txHash) throw new ValidationError('MISSING_TX_ID');
      if (!priceString) throw new ValidationError('MISSING_PRICE');
      const price = Number(priceString);
      if (!price || price <= 0) throw new ValidationError('INVALID_PRICE');
      const info = await getNFTTransferInfo(txHash, classId, nftId);
      if (!info) throw new ValidationError('NO_MATCHING_TX_HASH_AND_NFT_ID');
      const {
        fromAddress,
        toAddress,
        txTimestamp,
      } = info;
      if (toAddress !== LIKER_NFT_TARGET_ADDRESS) throw new ValidationError('INVALID_TX_RECEIVER');
      const iscnPrefix = await getISCNPrefixByClassId(classId);
      const owner = await getNFTOwner(classId, nftId);
      if (owner !== LIKER_NFT_TARGET_ADDRESS) throw new ValidationError('NFT_NOT_RECEIVED');

      await updateSellNFTInfo(iscnPrefix, {
        classId,
        nftId,
        price,
        sellerWallet: fromAddress,
        txTimestamp,
      });

      res.json({
        classId,
        iscnId: iscnPrefix,
        timestamp: txTimestamp,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTSellOffer',
        classId,
        nftId,
        iscnId: iscnPrefix,
        txHash,
        sellerWallet: fromAddress,
        apiWallet: LIKER_NFT_TARGET_ADDRESS,
        price,
        txTimestamp,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
