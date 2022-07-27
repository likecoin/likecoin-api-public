import axios from 'axios';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

const api = axios.create({ baseURL: COSMOS_LCD_INDEXER_ENDPOINT });

function aggregate(accounts) {
  const result = {};
  Object.entries(accounts).forEach(([owner, value]) => {
    console.log(owner, value);
    const collections = value.collections.map(
      ({ iscn_id_prefix: iscnPrefix, class_id: classId, count }) => {
        console.log(iscnPrefix, classId, count);
        return {
          test: 'hi',
          iscnPrefix,
          classId,
          count,
        };
      },
    );
    result[owner] = {
      collections,
      count: value.count,
    };
  });
  return result;
}

async function getCollector(creator) {
  try {
    const res = await api.get(
      `/likechain/likenft/v1/collector?creator=${creator}`,
    );
    console.dir(aggregate(res.data.collectors), { depth: null });
    return res.data;
  } catch (err) {
    console.log(err.message);
    return {};
  }
}

function getCreator(collector) {
  return {
    creators: { collector },
  };
}

export { getCollector, getCreator };
