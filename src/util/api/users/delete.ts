import {
  userCollection,
  userAuthCollection,
  subscriptionUserCollection,
  superLikeUserCollection,
  civicUserMetadataCollection,
  likeButtonUrlCollection,
  iscnMappingCollection,
  db,
} from '../../firebase';

const BATCH_SIZE = 250;

async function clearUserButtonData(user) {
  const query = await likeButtonUrlCollection
    .where('user', '==', user)
    .get();
  if (!query.docs.length) return;
  let batch = db.batch();
  let i;
  for (i = 0; i < query.docs.length; i += 1) {
    batch.delete(query.docs[i].ref);
    if (i % BATCH_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (i % BATCH_SIZE) await batch.commit();
}

async function clearUserMappingData(user) {
  const query = await iscnMappingCollection
    .where('likerId', '==', user)
    .get();
  if (!query.docs.length) return;
  let batch = db.batch();
  let i;
  for (i = 0; i < query.docs.length; i += 1) {
    batch.delete(query.docs[i].ref);
    if (i % BATCH_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (i % BATCH_SIZE) await batch.commit();
}

export async function deleteAllUserData(user) {
  await Promise.all([
    db.recursiveDelete(userCollection
      .doc(user)),
    db.recursiveDelete(userAuthCollection
      .doc(user)),
    db.recursiveDelete(subscriptionUserCollection
      .doc(user)),
    db.recursiveDelete(superLikeUserCollection
      .doc(user)),
    db.recursiveDelete(civicUserMetadataCollection
      .doc(user)),
    clearUserButtonData(user),
    clearUserMappingData(user),
  // eslint-disable-next-line no-console
  ].map(p => p.catch(e => console.error(e))));
  await userCollection
    .doc(user).set({ isDeleted: true, timestamp: Date.now() });
}

export default deleteAllUserData;
