import { FieldValue, likeNFTBookUserCollection } from '../../../firebase';
import { findUserDocByQuery } from '../../users';
import { ValidationError } from '../../../ValidationError';

export interface UserUnlimitedUploadQuery {
  query: string;
  isUnlimitedSponsoredUpload: boolean;
}

export interface UserUnlimitedUploadResult {
  user: string;
  wallet: string;
  isUnlimitedSponsoredUpload: boolean;
}

export const USER_UNLIMITED_UPLOAD_USAGE = '/user unlimited-upload <email|userId|wallet> <on|off>';

export function parseUserUnlimitedUploadQuery(params: string[]): UserUnlimitedUploadQuery {
  const [query, toggle, ...rest] = params;
  if (!query || !toggle || rest.length) {
    throw new Error(`Invalid params. Usage: ${USER_UNLIMITED_UPLOAD_USAGE}`);
  }
  const normalizedToggle = toggle.toLowerCase();
  if (normalizedToggle !== 'on' && normalizedToggle !== 'off') {
    throw new Error(`Invalid toggle: ${toggle}. Must be on or off`);
  }
  return { query, isUnlimitedSponsoredUpload: normalizedToggle === 'on' };
}

// Exempts the wallet from the daily Arweave sponsored upload limits;
// usage still accumulates (see arweave/quota.ts).
export async function setUserUnlimitedSponsoredUpload({
  query,
  isUnlimitedSponsoredUpload,
}: UserUnlimitedUploadQuery): Promise<UserUnlimitedUploadResult> {
  const { userDoc } = await findUserDocByQuery(query);
  const userData = userDoc?.data();
  if (!userDoc || !userData || userData.isDeleted) {
    throw new ValidationError(`User not found: ${query}`);
  }
  const wallet = userData.evmWallet || userData.likeWallet;
  if (!wallet) {
    throw new ValidationError(`User ${userDoc.id} has no wallet`);
  }
  await likeNFTBookUserCollection.doc(wallet).set({
    isUnlimitedSponsoredUpload,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { user: userDoc.id, wallet, isUnlimitedSponsoredUpload };
}
