import axios from 'axios';
import BigNumber from 'bignumber.js';
import { likeNFTCollection } from '../../firebase';
import { FIRESTORE_IN_QUERY_LIMIT } from '../../../constant';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

export async function getUserStat(wallet) {
  const { data: userStat } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/user-stat?user=${wallet}`);
  const {
    collected_classes: collectedClasses,
    created_count: createdClassCount,
    collector_count: createdCollectorCount,
    total_sales: totalSalesInNanolike,
  } = userStat;
  const createdTotalSales = Number(new BigNumber(totalSalesInNanolike).shiftedBy(-9).toFixed());
  const collectedClassCount = collectedClasses.length;
  const collectedClassIds: string[] = collectedClasses.map((c) => c.class_id);
  const batches: string[][] = [];
  for (let i = 0; i < collectedClassIds.length; i += FIRESTORE_IN_QUERY_LIMIT) {
    batches.push(collectedClassIds.slice(i, i + FIRESTORE_IN_QUERY_LIMIT));
  }
  const queries = await Promise.all(batches.map((classIds) => likeNFTCollection.where('classId', 'in', classIds).get()));
  const docs = queries.reduce((acc, q) => acc.concat(q.docs), [] as any[]);

  const priceMap = {};
  docs.forEach((doc) => {
    const { classId, currentPrice } = doc.data();
    priceMap[classId] = currentPrice;
  });

  let collectedCount = 0;
  let collectedValue = 0;
  collectedClasses.forEach((c) => {
    collectedCount += c.count;
    const price = priceMap[c.class_id];
    if (price) collectedValue += price * c.count;
  });
  return {
    collectedClassCount,
    collectedCount,
    collectedValue,
    createdClassCount,
    createdCollectorCount,
    createdTotalSales,
  };
}

export default getUserStat;
