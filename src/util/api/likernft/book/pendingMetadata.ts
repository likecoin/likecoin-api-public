import type { firestore } from 'firebase-admin';
import { db, FieldValue, likeNFTBookCollection } from '../../../firebase';
import type { NFTBookListingInfo } from '../../../../types/book';

export const PENDING_METADATA_FIELDS = ['genre', 'keywords'] as const;
export type PendingMetadataField = typeof PENDING_METADATA_FIELDS[number];

type PendingMetadata = Pick<NFTBookListingInfo, PendingMetadataField>;

// Null marks a pending field as cleared, so Airtable drops its copy too.
type ResolvedPendingMetadata = { [F in PendingMetadataField]?: PendingMetadata[F] | null };

type PendingMetadataUpdate = Record<string, string | string[] | firestore.FieldValue>;

type PendingMetadataListing = Pick<
  NFTBookListingInfo,
  PendingMetadataField | 'pendingMetadataFields' | 'pendingMetadataUpdatedAt'
>;

// publish stamps `recordTimestamp` when the owner signs class metadata,
// so a newer record means the owner has seen the pending values and chose what went on chain.
function isSignedAfterPendingWrite(recordTimestamp: unknown, listing: PendingMetadataListing) {
  if (typeof recordTimestamp !== 'string' || !listing.pendingMetadataUpdatedAt) return false;
  return Date.parse(recordTimestamp) > listing.pendingMetadataUpdatedAt.toMillis();
}

// Unlike `manualMetadataFields`, a pending field lifts itself once the owner signs,
// and the chain value then wins even when empty, or the publish prompt would keep coming back.
function resolvePendingMetadata(
  chainMetadata: PendingMetadata & { recordTimestamp?: unknown },
  listing: PendingMetadataListing,
): { update: PendingMetadataUpdate; metadata: ResolvedPendingMetadata } {
  const pendingFields = new Set(listing.pendingMetadataFields);
  const isSigned = pendingFields.size > 0
    && isSignedAfterPendingWrite(chainMetadata.recordTimestamp, listing);
  const update: PendingMetadataUpdate = {};
  const metadata: Record<string, unknown> = {};
  PENDING_METADATA_FIELDS.forEach((field) => {
    const isPending = pendingFields.has(field);
    const isKept = isPending && !isSigned;
    const value = isKept ? listing[field] : chainMetadata[field];
    const hasValue = !!value && (!Array.isArray(value) || value.length > 0);
    // Legacy books keep these only in the listing,
    // so only a pending field is cleared by an empty value.
    metadata[field] = hasValue || !isPending ? value : null;
    if (isKept) return;
    if (hasValue) {
      update[field] = value;
    } else if (isPending) {
      update[field] = FieldValue.delete();
    }
  });
  if (isSigned) {
    update.pendingMetadataFields = FieldValue.delete();
    update.pendingMetadataUpdatedAt = FieldValue.delete();
  }
  return { update, metadata: metadata as ResolvedPendingMetadata };
}

// Re-read in its own transaction after the slow chain read,
// so a `/settings` write committed meanwhile is neither overwritten nor lifted.
export async function updateListingWithPendingMetadata(
  classId: string,
  chainMetadata: PendingMetadata & { recordTimestamp?: unknown },
): Promise<ResolvedPendingMetadata> {
  const bookRef = likeNFTBookCollection.doc(classId);
  return db.runTransaction(async (t) => {
    const listing = (await t.get(bookRef)).data() || {};
    const { update, metadata } = resolvePendingMetadata(chainMetadata, listing);
    if (Object.keys(update).length) t.update(bookRef, update);
    return metadata;
  });
}
