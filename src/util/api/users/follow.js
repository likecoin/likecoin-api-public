import { db, userCollection as dbRef } from '../../firebase';
import { DEFAULT_FOLLOW_IDS } from '../../../constant';

export async function addDefaultFollowers(userId) {
  const batch = db.batch();
  const createObj = {
    isFollowed: true,
    ts: Date.now(),
  };
  DEFAULT_FOLLOW_IDS.forEach(id => batch.set(
    dbRef.doc(userId).collection('follow').doc(id),
    createObj,
  ));
  await batch.commit();
}

export async function addFollowUser(userId, followUserId) {
  const createObj = {
    isFollowed: true,
    ts: Date.now(),
  };
  await dbRef
    .doc(userId)
    .collection('follow')
    .doc(followUserId)
    .set(createObj, { merge: true });
}
