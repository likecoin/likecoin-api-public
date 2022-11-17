import axios from 'axios';
import { db, likeNFTCollection } from '../../firebase';
import { getNFTISCNOwner } from '../../cosmos/nft';
import { FIRESTORE_IN_QUERY_LIMIT } from '../../../constant';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

const BATCH_SIZE = 200;

export async function filterOwnedClassIds(iscnDocs, wallet) {
  const classIdSet = new Set();
  iscnDocs.forEach((doc) => {
    classIdSet.add(doc.data().classId);
  });
  const docsToUpdate: {doc, owner: string}[] = [];
  const checkOwnerPromises = iscnDocs.map(async (doc) => {
    const iscnPrefix = decodeURIComponent(doc.id);
    const owner = await getNFTISCNOwner(iscnPrefix);
    if (owner && owner !== wallet) {
      docsToUpdate.push({ doc, owner });
      classIdSet.delete(doc.data().classId);
    }
  });
  await Promise.all(checkOwnerPromises);

  if (docsToUpdate.length) {
    const batches: {doc, owner: string}[][] = [];
    for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
      batches.push(docsToUpdate.slice(i, i + BATCH_SIZE));
    }
    const updatePromises = batches.map((docs) => {
      const batch = db.batch();
      docs.forEach(({ doc, owner }) => batch.update(doc.ref, { ownerWallet: owner }));
      return batch.commit();
    });
    await Promise.all(updatePromises);
  }
  return Array.from(classIdSet);
}

export async function getUserStat(wallet) {
  const { data: userStat } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/user-stat?user=${wallet}`);
  const {
    collected_classes: collectedClasses,
    created_count: createdClassCount,
    collector_count: createdCollectorCount,
  } = userStat;
  const collectedClassCount = collectedClasses.length;
  const collectedClassIds: string[] = collectedClasses.map(c => c.class_id);
  const batches: string[][] = [];
  for (let i = 0; i < collectedClassIds.length; i += FIRESTORE_IN_QUERY_LIMIT) {
    batches.push(collectedClassIds.slice(i, i + FIRESTORE_IN_QUERY_LIMIT));
  }
  const queries = await Promise.all(batches.map(classIds => likeNFTCollection.where('classId', 'in', classIds).get()));
  const docs = queries.reduce((acc, q) => acc.concat(q.docs), []);

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
  };
}
