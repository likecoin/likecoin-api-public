import { Router } from 'express';
import axios from 'axios';
import { ValidationError } from '../../util/ValidationError';
import { getISCNDocByClassId } from '../../util/api/likernft';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../config/config';

const router = Router();

router.get(
  '/history',
  fetchISCNIdAndClassId,
  async (req, res, next) => {
    try {
      const { nft_id: nftId } = req.query;
      const { classId } = res.locals;
      if (nftId && !classId) {
        throw new ValidationError('PLEASE_DEFINE_CLASS_ID');
      }
      let list = [];
      const doc = await getISCNDocByClassId(classId);
      let queryObj = await doc.ref.collection('transaction');
      if (nftId) queryObj = queryObj.where('nftId', '==', nftId);
      const query = await queryObj.orderBy('timestamp', 'desc').get();
      list = query.docs.map(d => ({ txHash: d.id, ...(d.data() || {}) }));
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
  fetchISCNIdAndClassId,
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
      let list = [];
      list = list.concat(newClassData.tx_responses || []);
      let set = new Set(list.map(t => t.txhash));
      list = list.concat((mintData.tx_responses || []).filter(t => !set.has(t.txhash)));
      set = new Set(list.map(t => t.txhash));
      list = list.concat((sendData.tx_responses || []).filter(t => !set.has(t.txhash)));
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
