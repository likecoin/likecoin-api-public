import BigNumber from 'bignumber.js';
import { db, likeNFTBookUserCollection, FieldValue } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import {
  ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT,
  ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT,
} from '../../../../config/config';
import type { NFTBookUserData } from '../../../types/book';

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function readTodayQuota(data: NFTBookUserData | undefined, today: string) {
  const isToday = data?.lastSponsoredUploadDate === today;
  return {
    currentBytes: isToday ? (data?.sponsoredUploadBytes || 0) : 0,
    currentCount: isToday ? (data?.sponsoredUploadCount || 0) : 0,
    currentETH: isToday ? (data?.sponsoredUploadETH || '0') : '0',
  };
}

function hasUnlimitedSponsoredUpload(data: NFTBookUserData | undefined): boolean {
  return data?.isUnlimitedSponsoredUpload === true;
}

type RemainingQuota =
  | { isUnlimited: true }
  | { isUnlimited: false; remainingBytes: number; remainingUploads: number };

export async function getRemainingQuota(wallet: string): Promise<RemainingQuota> {
  const doc = await likeNFTBookUserCollection.doc(wallet).get();
  const data = doc.data();
  if (hasUnlimitedSponsoredUpload(data)) {
    return { isUnlimited: true };
  }
  const today = getTodayUTC();
  const { currentBytes, currentCount } = readTodayQuota(data, today);
  return {
    remainingBytes: Math.max(0, ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT - currentBytes),
    remainingUploads: Math.max(0, ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT - currentCount),
    isUnlimited: false,
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
    const isUnlimited = hasUnlimitedSponsoredUpload(data);
    const { currentBytes, currentCount, currentETH } = readTodayQuota(data, today);

    if (!isUnlimited) {
      if (currentBytes + fileSize > ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT) {
        throw new ValidationError('DAILY_QUOTA_EXCEEDED', 403);
      }
      if (currentCount + 1 > ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT) {
        throw new ValidationError('DAILY_QUOTA_EXCEEDED', 403);
      }
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

export async function rollbackQuota(
  wallet: string,
  fileSize: number,
  ethCost: string,
): Promise<void> {
  const today = getTodayUTC();
  const docRef = likeNFTBookUserCollection.doc(wallet);
  const snapshot = await docRef.get();
  if (snapshot.data()?.lastSponsoredUploadDate !== today) {
    // eslint-disable-next-line no-console
    console.warn(`Skipping quota rollback for ${wallet}: date mismatch`);
    return;
  }
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const { currentBytes, currentCount, currentETH } = readTodayQuota(doc.data(), today);
    if (!currentBytes && !currentCount) return;
    t.set(docRef, {
      sponsoredUploadBytes: Math.max(0, currentBytes - fileSize),
      sponsoredUploadCount: Math.max(0, currentCount - 1),
      sponsoredUploadETH: BigNumber.max(0, new BigNumber(currentETH).minus(ethCost)).toFixed(),
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

// Reserve quota, run fn, and roll the reservation back (best-effort) when fn
// throws. The reserve/rollback pairing lives here so handlers cannot forget it.
export async function withReservedQuota<T>(
  wallet: string,
  fileSize: number,
  ethCost: string,
  fn: () => Promise<T>,
): Promise<T> {
  await checkAndReserveQuota(wallet, fileSize, ethCost);
  try {
    return await fn();
  } catch (err) {
    await rollbackQuota(wallet, fileSize, ethCost).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('Failed to rollback quota', e);
    });
    throw err;
  }
}
