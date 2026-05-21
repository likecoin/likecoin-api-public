import { userCollection as dbRef } from '../../firebase';

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

export default addFollowUser;
