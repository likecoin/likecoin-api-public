import { db } from '../../firebase';
import { getNFTISCNOwner } from '../../cosmos/nft';

export async function filterOwnedClassIds(iscnDocs, wallet) {
  const classIdSet = new Set();
  iscnDocs.forEach((doc) => {
    classIdSet.add(doc.data().classId);
  });
  let count = 0;
  let batch = db.batch();
  const promises = iscnDocs.map(async (doc) => {
    const iscnPrefix = decodeURIComponent(doc.id);
    const owner = await getNFTISCNOwner(iscnPrefix);
    if (owner && owner !== wallet) {
      classIdSet.delete(doc.data().classId);
      batch.update({ ownerWallet: owner });
      count += 1;
      if (count % 200 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  });
  await Promise.all(promises);
  if (count % 200) await batch.commit();
  return Array.from(classIdSet);
}

export default filterOwnedClassIds;
