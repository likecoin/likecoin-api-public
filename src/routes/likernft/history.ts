import { Router } from 'express';
import axios from 'axios';
import { ValidationError } from '../../util/ValidationError';
import { getISCNDocByClassId } from '../../util/api/likernft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../config/config';
import { ONE_DAY_IN_S } from '../../constant';

const router = Router();

router.get(
  '/history',
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      const { nft_id: nftId, tx_hash: txHash } = req.query;
      const { classId } = res.locals;
      if (nftId && !classId) {
        throw new ValidationError('PLEASE_DEFINE_CLASS_ID');
      }
      if (nftId && txHash) {
        throw new ValidationError('CANNOT_DEFINE_BOTH_NFT_ID_AND_TX_HASH');
      }
      let list = [];
      const doc = await getISCNDocByClassId(classId);
      let queryObj = await doc.ref.collection('transaction');
      if (txHash) queryObj = queryObj.where('txHash', '==', txHash);
      else if (nftId) queryObj = queryObj.where('nftId', '==', nftId);
      const query = await queryObj.orderBy('timestamp', 'desc').get();
      list = query.docs.map((d) => ({ txHash: d.id, ...(d.data() || {}) }));
      res.set('Cache-Control', `public, max-age=${6}, s-maxage=${6}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json({
        list,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/events',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId } = res.locals;
      const [
        { data: newClassData },
        { data: mintData },
        { data: sendData },
      ] = await Promise.all([
        axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs?events=likechain.likenft.v1.EventNewClass.class_id=%27%22${classId}%22%27`),
        axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs?events=likechain.likenft.v1.EventMintNFT.class_id=%27%22${classId}%22%27`),
        axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs?events=cosmos.nft.v1beta1.EventSend.class_id=%27%22${classId}%22%27`),
      ]);
      let list: any[] = [];
      list = list.concat(newClassData.tx_responses || []);
      let set = new Set(list.map((t) => t.txhash));
      list = list.concat((mintData.tx_responses || []).filter((t) => !set.has(t.txhash)));
      set = new Set(list.map((t) => t.txhash));
      list = list.concat((sendData.tx_responses || []).filter((t) => !set.has(t.txhash)));
      list = list.map((d) => {
        const {
          height,
          txhash,
          code,
          logs,
          tx,
          timestamp,
        } = d;
        return {
          height,
          txhash,
          code,
          logs,
          tx,
          timestamp,
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
      res.json({
        list,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
