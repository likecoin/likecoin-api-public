import axios from 'axios';

import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';
import { getLatestNFTPriceAndInfo } from './purchase';

const api = axios.create({
  baseURL: COSMOS_LCD_INDEXER_ENDPOINT,
});

function aggregate(classes) {
  const promises = classes.map(
    c => getLatestNFTPriceAndInfo(c.parent.iscn_id_prefix, c.id, false)
      .then(({ lastSoldPrice: price, soldCount }) => ({
        ...c,
        price,
        soldCount,
      }))
      .catch(() => ({
        ...c,
        price: 0,
        soldCount: 0,
      })),
  );
  return Promise.all(promises);
}

async function getRanking(queryString, order) {
  const res = await api.get(`/likechain/likenft/v1/ranking?${queryString}`);
  const newClasses = res.data.classes
    ? (await aggregate(res.data.classes)).sort((a, b) => b[order] - a[order])
    : [];
  return {
    ...res.data,
    classes: newClasses,
  };
}

export default getRanking;
