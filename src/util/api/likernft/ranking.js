import axios from 'axios';

import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';
import { getLatestNFTPriceAndInfo } from './purchase';

const api = axios.create({
  baseURL: COSMOS_LCD_INDEXER_ENDPOINT,
});

function aggregate(classes) {
  const promises = classes.map(
    c => getLatestNFTPriceAndInfo(c.parent.iscn_id_prefix, c.id, false)
      .then(({ lastSoldPrice: price }) => ({
        ...c,
        price,
      }))
      .catch(() => c),
  );
  return Promise.all(promises);
}

async function getRanking() {
  const res = await api.get('/likechain/likenft/v1/ranking');
  const newClasses = (await aggregate(res.data.classes)).sort((a, b) => b.price - a.price);
  return {
    ...res.data,
    classes: newClasses,
  };
}

export default getRanking;
