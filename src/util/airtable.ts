import Airtable from 'airtable';

import { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } from '../../config/config';

import { TEST_MODE } from '../constant';

import { getUserWithCivicLikerPropertiesByWallet } from './api/users';

const airtable = new Airtable({ apiKey: AIRTABLE_API_KEY });
const base = airtable.base(AIRTABLE_BASE_ID);

export async function createAirtablePublicationRecord({
  timestamp,
  id,
  name,
  description,
  iscnIdPrefix,
  iscnVersionAtMint,
  ownerWallet,
  type,
  minPrice,
  maxPrice,
  imageURL,
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
  iscnVersionAtMint?: number;
}): Promise<void> {
  if (TEST_MODE) return Promise.resolve();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any = {
      Timestamp: timestamp.toISOString(),
      'Owner Wallet': ownerWallet,
      Type: type,
      ID: id,
      Name: name,
      Description: description,
      Image: [{ url: imageURL }],
      'Image URL': imageURL,
      'Min Price': minPrice,
      'Max Price': maxPrice,
    };

    if (iscnIdPrefix) {
      fields['ISCN Id Prefix'] = iscnIdPrefix;
    }
    if (iscnVersionAtMint) {
      fields['ISCN Version At Mint'] = iscnVersionAtMint;
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

  return Promise.resolve();
}

export default createAirtablePublicationRecord;
