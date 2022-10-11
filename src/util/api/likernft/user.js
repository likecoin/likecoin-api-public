import { db } from '../../firebase';
import { getNFTISCNOwner } from '../../cosmos/nft';

const BATCH_SIZE = 200;

export async function filterOwnedClassIds(iscnDocs, wallet) {
  const classIdSet = new Set();
  iscnDocs.forEach((doc) => {
    classIdSet.add(doc.data().classId);
  });
  const docsToUpdate = [];
  const checkOwnerPromises = iscnDocs.map(async (doc) => {
    const iscnPrefix = decodeURIComponent(doc.id);
    const owner = await getNFTISCNOwner(iscnPrefix);
    if (owner && owner !== wallet) {
      docsToUpdate.push(doc);
      classIdSet.delete(doc.data().classId);
    }
  });
  await Promise.all(checkOwnerPromises);

  if (docsToUpdate.length) {
    const batches = [];
    for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
      batches.push(docsToUpdate.slice(i, i + BATCH_SIZE));
    }
    const updatePromises = batches.map((docs) => {
      const batch = db.batch();
      docs.forEach(doc => batch.update(doc.ref, { ownerWallet: wallet }));
      return batch.commit();
    });
    await Promise.all(updatePromises);
  }
  return Array.from(classIdSet);
}

export default filterOwnedClassIds;
