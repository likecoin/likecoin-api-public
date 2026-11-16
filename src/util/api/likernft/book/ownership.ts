import type { Request } from 'express';
import { getAddress } from 'viem';
import { ValidationError } from '../../../ValidationError';
import {
  FieldValue,
  Timestamp,
  db,
  likeNFTBookCollection,
  likeNFTBookUserCollection,
} from '../../../firebase';
import { getNFTClassOwner, isEVMClassId } from '../../../evm/nft';
import { updateAirtablePublicationRecord } from '../../../airtable';
import { checkIsAuthorized, getNftBookInfo, isNonNFTProduct } from '.';
import type { NFTBookListingInfo } from '../../../../types/book';

// Moves the owner's share to the new owner, so sales after the transfer pay them;
// shares held by other wallets are left as they are.
function reassignConnectedWallets(
  connectedWallets: Record<string, number>,
  fromWallet: string,
  toWallet: string,
) {
  const { [fromWallet]: share, ...rest } = connectedWallets;
  return { ...rest, [toWallet]: (rest[toWallet] || 0) + share };
}

// The current owner signs transferOwnership on chain first; this only syncs
// the listing, and only once the chain already names the new owner.
export default async function transferNFTBookOwnership(classId: string, {
  newOwnerWallet,
  txHash,
}: {
  newOwnerWallet: string;
  txHash?: string;
}, req: Pick<Request, 'user'>) {
  const toWallet = getAddress(newOwnerWallet);
  const bookInfo = await getNftBookInfo(classId);
  const { ownerWallet: fromWallet } = bookInfo;
  if (!checkIsAuthorized({ ownerWallet: fromWallet }, req)) {
    throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
  }
  if (isNonNFTProduct(bookInfo) || !isEVMClassId(classId)) {
    throw new ValidationError('OWNERSHIP_TRANSFER_NOT_SUPPORTED', 400);
  }
  // Migrated listings may still name a legacy like1 owner, so compare as plain strings.
  if (fromWallet.toLowerCase() === toWallet.toLowerCase()) {
    throw new ValidationError('SAME_OWNER_WALLET', 400);
  }
  const chainOwner = await getNFTClassOwner(classId, { skipCache: true });
  if (getAddress(chainOwner) !== toWallet) {
    throw new ValidationError('ON_CHAIN_OWNER_MISMATCH', 409);
  }

  const bookRef = likeNFTBookCollection.doc(classId);
  await db.runTransaction(async (t) => {
    const doc = await t.get(bookRef);
    const { ownerWallet, connectedWallets } = doc.data() as NFTBookListingInfo;
    // A concurrent transfer may have landed since the checks above.
    if (ownerWallet !== fromWallet) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    const payload: any = {
      ownerWallet: toWallet,
      ownershipHistory: FieldValue.arrayUnion({
        fromWallet,
        toWallet,
        txHash: txHash || null,
        timestamp: Timestamp.now(),
      }),
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    };
    if (connectedWallets?.[fromWallet] !== undefined) {
      // A payout share on a wallet without Stripe Connect is skipped at checkout,
      // which would hand the owner's cut to the other connected wallets.
      const newOwnerDoc = await t.get(likeNFTBookUserCollection.doc(toWallet));
      if (!newOwnerDoc.data()?.isStripeConnectReady) {
        throw new ValidationError('NEW_OWNER_STRIPE_CONNECT_NOT_READY', 400);
      }
      payload.connectedWallets = reassignConnectedWallets(connectedWallets, fromWallet, toWallet);
    }
    t.update(bookRef, payload);
  });

  await updateAirtablePublicationRecord({ id: classId, ownerWallet: toWallet });

  return { fromWallet, toWallet };
}
