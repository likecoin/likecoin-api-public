import axios from 'axios';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';
import { getLatestNFTPriceAndInfo } from './purchase';

const api = axios.create({ baseURL: COSMOS_LCD_INDEXER_ENDPOINT });

async function aggregate(accounts) {
  const newAccounts = {};
  const promises = [];
  Object.entries(accounts).forEach(([owner, value]) => {
    console.log(owner);
    newAccounts[owner] = {
      collections: [],
      count: value.count,
      totalValue: 0,
    };
    value.collections.forEach(
      ({ iscn_id_prefix: iscnPrefix, class_id: classId, count }) => {
        console.log(iscnPrefix, classId, count);
        promises.push(
          new Promise((resolve, reject) => {
            getLatestNFTPriceAndInfo(iscnPrefix, classId)
              .then(({ price }) => {
                newAccounts[owner].collections.push({
                  iscnPrefix,
                  classId,
                  count,
                  price,
                  totalValue: count * price,
                });
                newAccounts[owner].totalValue += count * price;
                resolve(true);
              })
              .catch(reject);
          }),
        );
      },
    );
  });
  console.log(promises);
  await Promise.all(promises);
  return newAccounts;
}

async function getCollector(creator) {
  try {
    const res = await api.get(
      `/likechain/likenft/v1/collector?creator=${creator}`,
    );
    const payload = {
      ...res.data,
      collectors: await aggregate(res.data.collectors),
    };

    console.dir(payload, { depth: null });
    return payload;
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
