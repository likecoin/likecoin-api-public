import type { firestore } from 'firebase-admin';
import { db, FieldValue, likeNFTBookCollection } from '../../../firebase';
import type { NFTBookListingInfo } from '../../../../types/book';
import { parseBookInfoClassId } from './adminInfo';
import { compactISBN, isValidISBN } from './isbn';

export const MANUAL_METADATA_FIELDS = ['name', 'alternativeHeadline', 'isbn'] as const;
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

export const getBookMetadataUsage = (command: string) => `${command} metadata <classId> set <${MANUAL_METADATA_FIELDS.join('|')}> <value> | ${command} metadata <classId> reset <field>`;

export type BookMetadataQuery = {
  classId: string;
  action: 'set';
  field: ManualMetadataField;
  value: string;
} | {
  classId: string;
  action: 'reset';
  field: ManualMetadataField;
};

export interface BookMetadataResult {
  classId: string;
  className: string;
  manualMetadataFields: ManualMetadataField[];
}

function isManualMetadataField(field: string): field is ManualMetadataField {
  return (MANUAL_METADATA_FIELDS as readonly string[]).includes(field);
}

export function parseBookMetadataQuery(params: string[], command: string): BookMetadataQuery {
  const [rawClassId, action, field, ...valueParts] = params;
  if (!rawClassId || !action || !field) {
    throw new Error(`Invalid params. Usage: ${getBookMetadataUsage(command)}`);
  }
  const classId = parseBookInfoClassId(rawClassId, command);
  if (!isManualMetadataField(field)) {
    throw new Error(`Invalid field: ${field}. Must be one of ${MANUAL_METADATA_FIELDS.join(', ')}`);
  }
  if (action === 'reset') {
    if (valueParts.length) throw new Error(`Invalid params. Usage: ${getBookMetadataUsage(command)}`);
    return { classId, action, field };
  }
  if (action !== 'set') throw new Error(`Invalid action: ${action}. Must be set or reset`);
  // Slack splits the command text on whitespace, so a value with spaces arrives in parts.
  const value = valueParts.join(' ');
  if (!value) throw new Error(`Missing value. Usage: ${getBookMetadataUsage(command)}`);
  if (field === 'isbn') {
    if (!isValidISBN(value)) throw new Error(`Invalid ISBN: ${value}`);
    return {
      classId, action, field, value: compactISBN(value),
    };
  }
  return {
    classId, action, field, value,
  };
}

// `set` writes the listing value and marks it manual so refresh keeps it;
// `reset` only unmarks it, and the chain value returns on the next refresh.
export async function setBookManualMetadata(query: BookMetadataQuery): Promise<BookMetadataResult> {
  const { classId, field } = query;
  const bookRef = likeNFTBookCollection.doc(classId);
  return db.runTransaction(async (t) => {
    const bookData = (await t.get(bookRef)).data();
    if (!bookData) {
      throw new Error(`Book class ${classId} not found`);
    }
    const manualFields = new Set(bookData.manualMetadataFields);
    const update: Record<string, string | string[] | firestore.FieldValue> = {
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    };
    if (query.action === 'set') {
      manualFields.add(field);
      update[field] = query.value;
    } else {
      manualFields.delete(field);
    }
    const manualMetadataFields = [...manualFields];
    update.manualMetadataFields = manualMetadataFields.length
      ? manualMetadataFields
      : FieldValue.delete();
    t.update(bookRef, update);
    const name = query.action === 'set' && field === 'name' ? query.value : bookData.name;
    return {
      classId,
      className: name || classId,
      manualMetadataFields,
    };
  });
}
