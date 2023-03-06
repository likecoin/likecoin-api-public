import {
  likeNFTSubscriptionUserCollection,
  likeNFTSubscriptionTxCollection,
  FieldValue,
} from '../../../firebase';

export async function checkUserIsActiveNFTSubscriber(wallet: string): Promise<boolean> {
  const doc = await likeNFTSubscriptionUserCollection().doc(wallet).get();
  const docData = doc.data();
  if (!docData) return false;
  const { currentPeriodStart, currentPeriodEnd } = docData;
  const now = Date.now();
  return currentPeriodStart < now && currentPeriodEnd > now;
}

export async function createNewMintTransaction(wallet: string): Promise<string> {
  const res = await likeNFTSubscriptionTxCollection().add({
    wallet,
    status: 'new',
    isProcessing: false,
    timestamp: FieldValue.serverTimestamp,
  });
  return res.id;
}

export async function getAllMintTransaction(wallet: string): Promise<string> {
  const res = await likeNFTSubscriptionTxCollection().where(wallet).orderBy('timestamp', 'desc').get();
  const docs = res.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return docs;
}

export default checkUserIsActiveNFTSubscriber;
