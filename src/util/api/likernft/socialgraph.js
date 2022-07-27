import axios from 'axios';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

const api = axios.create({ baseURL: COSMOS_LCD_INDEXER_ENDPOINT });

async function getCollector(creator) {
  try {
    const res = await api.get(
      `/likechain/likenft/v1/collector?creator=${creator}`,
    );
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
