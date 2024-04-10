import Airtable from 'airtable';

import { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } from '../../config/config';

import { getUserWithCivicLikerPropertiesByWallet } from './api/users';
import { parseImageURLFromMetadata } from './api/likernft/metadata';

let airtable: Airtable;
let base: Airtable.Base;

if (!process.env.CI) {
  airtable = new Airtable({ apiKey: AIRTABLE_API_KEY });
  base = airtable.base(AIRTABLE_BASE_ID);
}

export async function createAirtablePublicationRecord({
  timestamp,
  id,
  name,
  description,
  iscnIdPrefix,
  ownerWallet,
  type,
  minPrice,
  maxPrice,
  imageURL,
  iscnObject,
  metadata,
}: {
  timestamp: Date;
  name: string;
  description: string;
  id: string;
  ownerWallet: string;
  type: string;
  minPrice: number;
  maxPrice: number;
  imageURL: string;
  iscnIdPrefix?: string;
  iscnObject?: any;
  metadata?: any;
}): Promise<void> {
  if (!base) return;

  const normalizedImageURL = parseImageURLFromMetadata(imageURL);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any = {
      Timestamp: timestamp.toISOString(),
      'Owner Wallet': ownerWallet,
      Type: type,
      ID: id,
      Name: name,
      Description: description,
      Image: [{ url: normalizedImageURL }],
      'Image URL': normalizedImageURL,
      'Min Price': minPrice,
      'Max Price': maxPrice,
    };

    if (iscnIdPrefix) {
      fields['ISCN Id Prefix'] = iscnIdPrefix;
    }

    if (iscnObject) {
      try {
        fields['ISCN Object'] = JSON.stringify(iscnObject);
      } catch {
        // No-op
      }
    }

    if (metadata) {
      try {
        fields.Metadata = JSON.stringify(metadata);
      } catch {
        // No-op
      }
    }

    const ownerData = await getUserWithCivicLikerPropertiesByWallet(ownerWallet);
    if (ownerData) {
      fields['Owner Liker Id'] = ownerData.user;
      fields['Owner Name'] = ownerData.displayName;
    }

    await base('Publications').create([{ fields }]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export default createAirtablePublicationRecord;
