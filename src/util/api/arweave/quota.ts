import BigNumber from 'bignumber.js';
import { db, likeNFTBookUserCollection, FieldValue } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import {
  ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT,
  ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT,
} from '../../../../config/config';

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getRemainingQuota(wallet: string): Promise<{
  remainingBytes: number;
  remainingUploads: number;
}> {
  const doc = await likeNFTBookUserCollection.doc(wallet).get();
  const data = doc.data();
  const today = getTodayUTC();
  const isToday = data?.lastSponsoredUploadDate === today;
  const usedBytes = isToday ? (data?.sponsoredUploadBytes || 0) : 0;
  const usedCount = isToday ? (data?.sponsoredUploadCount || 0) : 0;
  return {
    remainingBytes: Math.max(0, ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT - usedBytes),
    remainingUploads: Math.max(0, ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT - usedCount),
  };
}

export async function checkAndReserveQuota(
  wallet: string,
  fileSize: number,
  ethCost: string,
): Promise<void> {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new ValidationError('INVALID_FILE_SIZE');
  }
  const ethCostBN = new BigNumber(ethCost);
  if (!ethCost || ethCostBN.isNaN() || ethCostBN.isNegative()) {
    throw new ValidationError('INVALID_ETH_COST');
  }
  const today = getTodayUTC();
  const docRef = likeNFTBookUserCollection.doc(wallet);
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const data = doc.data();
    const isToday = data?.lastSponsoredUploadDate === today;
    const currentBytes = isToday ? (data?.sponsoredUploadBytes || 0) : 0;
    const currentCount = isToday ? (data?.sponsoredUploadCount || 0) : 0;
    const currentETH = isToday ? (data?.sponsoredUploadETH || '0') : '0';

    if (currentBytes + fileSize > ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT) {
      throw new ValidationError('DAILY_QUOTA_EXCEEDED', 403);
    }
    if (currentCount + 1 > ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT) {
      throw new ValidationError('DAILY_QUOTA_EXCEEDED', 403);
    }

    const newETH = new BigNumber(currentETH).plus(ethCostBN).toFixed();
    t.set(docRef, {
      sponsoredUploadBytes: currentBytes + fileSize,
      sponsoredUploadCount: currentCount + 1,
      sponsoredUploadETH: newETH,
      lastSponsoredUploadDate: today,
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}
