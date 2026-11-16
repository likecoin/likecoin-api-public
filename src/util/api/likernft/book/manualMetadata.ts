import { db, likeNFTBookCollection } from '../../../firebase';
import type { NFTBookListingInfo } from '../../../../types/book';

export const MANUAL_METADATA_FIELDS = ['name', 'isbn'] as const;
export type ManualMetadataField = typeof MANUAL_METADATA_FIELDS[number];

type ListingMetadata = Partial<Record<ManualMetadataField, string>>;

// Refresh copies these from chain, which would revert a staff correction in the listing,
// so a field in `manualMetadataFields` keeps the listing value until signed to chain.
// Chain JSON is untrusted, so only a non-empty string replaces the listing value.
export function resolveListingMetadata(
  chainMetadata: Partial<Record<ManualMetadataField, unknown>>,
  listing: Pick<NFTBookListingInfo, ManualMetadataField | 'manualMetadataFields'>,
): ListingMetadata {
  const manualFields = new Set(listing.manualMetadataFields);
  const resolved: ListingMetadata = {};
  MANUAL_METADATA_FIELDS.forEach((field) => {
    const chainValue = chainMetadata[field];
    const value = !manualFields.has(field) && typeof chainValue === 'string' && chainValue
      ? chainValue
      : listing[field];
    if (value) resolved[field] = value;
  });
  return resolved;
}

// The chain read is slow, so the listing is re-read in the write transaction;
// a manual correction committed meanwhile must not be overwritten by the earlier read.
export async function updateListingWithChainMetadata(
  classId: string,
  chainMetadata: Partial<Record<ManualMetadataField, unknown>>,
  payload: Record<string, unknown>,
): Promise<ListingMetadata> {
  const bookRef = likeNFTBookCollection.doc(classId);
  return db.runTransaction(async (t) => {
    const listing = (await t.get(bookRef)).data() || {};
    const listingMetadata = resolveListingMetadata(chainMetadata, listing);
    t.update(bookRef, { ...payload, ...listingMetadata });
    return listingMetadata;
  });
}
