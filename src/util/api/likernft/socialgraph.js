import axios from 'axios';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';
import { getLatestNFTPriceAndInfo } from './purchase';

const api = axios.create({ baseURL: COSMOS_LCD_INDEXER_ENDPOINT });

async function aggregate(accounts) {
  const promises = [];
  const newAccounts = [];
  Object.entries(accounts).forEach(([owner, value]) => {
    const account = {
      account: owner,
      collections: [],
      count: value.count,
      totalValue: 0,
    };
    value.collections.forEach(
      ({ iscn_id_prefix: iscnPrefix, class_id: classId, count }) => {
        promises.push(
          getLatestNFTPriceAndInfo(iscnPrefix, classId)
            .then(({ lastSoldPrice: price }) => {
              account.collections.push({
                iscnPrefix,
                classId,
                count,
                price,
                totalValue: count * price,
              });
              account.totalValue += count * price;
            })
            .catch((err) => {
              console.log(err, iscnPrefix, classId);
              account.collections.push({
                iscnPrefix,
                classId,
                count,
                price: 0,
                totalValue: 0,
              });
            }),
        );
      },
    );
    newAccounts.push(account);
  });
  await Promise.all(promises);
  return newAccounts.sort((a, b) => b.totalValue - a.totalValue);
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

    return payload;
  } catch (err) {
    throw err;
  }
}

async function getCreator(collector) {
  try {
    const res = await api.get(
      `/likechain/likenft/v1/creator?collector=${collector}`,
    );
    const payload = {
      ...res.data,
      creators: await aggregate(res.data.creators),
    };

    return payload;
  } catch (err) {
    throw err;
  }
}

export { getCollector, getCreator };
