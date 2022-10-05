import { db } from '../../firebase';
import { getNFTISCNOwner } from '../../cosmos/nft';

export async function filterOwnedClassIds(iscnDocs, wallet) {
  const classIdSet = new Set();
  iscnDocs.forEach((doc) => {
    classIdSet.add(doc.data().classId);
  });
  let isEmptyBatch = true;
  const batch = db.batch();
  const promises = iscnDocs.map(async (doc) => {
    const iscnPrefix = decodeURIComponent(doc.id);
    const owner = await getNFTISCNOwner(iscnPrefix);
    if (owner && owner !== wallet) {
      classIdSet.delete(doc.data().classId);
      batch.update({ ownerWallet: owner });
      isEmptyBatch = false;
    }
  });
  await Promise.all(promises);
  if (!isEmptyBatch) await batch.commit();
  return Array.from(classIdSet);
}

export default filterOwnedClassIds;
