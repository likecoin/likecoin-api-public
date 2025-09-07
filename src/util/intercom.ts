import jwt, { JwtPayload } from 'jsonwebtoken';
import { IntercomClient } from 'intercom-client';
import { CreateContactRequest } from 'intercom-client/api/types';
import {
  INTERCOM_API_SECRET,
  INTERCOM_ACCESS_TOKEN,
} from '../../config/config';

let intercomClient: IntercomClient | null = null;

function getIntercomClient(): IntercomClient | null {
  if (!INTERCOM_ACCESS_TOKEN) return null;
  if (!intercomClient) {
    intercomClient = new IntercomClient({ token: INTERCOM_ACCESS_TOKEN });
  }
  return intercomClient;
}

export function createIntercomToken(payload: JwtPayload): string | undefined {
  if (!INTERCOM_API_SECRET) return undefined;
  return jwt.sign(payload, INTERCOM_API_SECRET, { expiresIn: '1h' });
}

export async function createIntercomUser({
  userId,
  email,
  name,
  signedUpAt,
  avatar,
  evmWallet,
}: {
  userId: string;
  email?: string;
  name?: string;
  signedUpAt?: number;
  avatar?: string;
  evmWallet?: string;
}): Promise<boolean> {
  const client = getIntercomClient();
  if (!client) return false;

  try {
    const userData: CreateContactRequest = {
      external_id: userId,
      name: name || userId,
      signed_up_at: signedUpAt ? Math.floor(signedUpAt / 1000) : Math.floor(Date.now() / 1000),
      custom_attributes: {
        platform: 'likecoin',
        user_id: userId,
        ...(evmWallet && { evm_wallet: evmWallet }),
      },
    };

    if (email) {
      (userData as any).email = email;
    }

    if (avatar) {
      userData.avatar = avatar;
    }

    await client.contacts.create(userData);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error creating Intercom user:', error);
    return false;
  }
}

export async function updateIntercomUserLikerPlusStatus({
  userId,
  isLikerPlus,
  likerPlusPeriod,
  likerPlusSince,
  likerPlusCurrentPeriodEnd,
}: {
  userId: string;
  isLikerPlus: boolean;
  likerPlusPeriod?: string;
  likerPlusSince?: number;
  likerPlusCurrentPeriodEnd?: number;
}): Promise<boolean> {
  const client = getIntercomClient();
  if (!client) return false;

  try {
    const customAttributes: Record<string, unknown> = {
      is_liker_plus: isLikerPlus,
    };

    if (isLikerPlus) {
      if (likerPlusPeriod) customAttributes.liker_plus_period = likerPlusPeriod;
      if (likerPlusSince) customAttributes.liker_plus_since = Math.floor(likerPlusSince / 1000);
      if (likerPlusCurrentPeriodEnd) {
        customAttributes.liker_plus_current_period_end = Math.floor(
          likerPlusCurrentPeriodEnd / 1000,
        );
      }
    }

    // Find the contact by external_id to get contact_id
    const searchResult = await client.contacts.search({
      query: {
        field: 'external_id',
        operator: '=',
        value: userId,
      },
    });

    const contact = searchResult.data?.[0];
    if (!contact || !contact.id) {
      throw new Error(`Contact with external_id ${userId} not found`);
    }

    await client.contacts.update({
      contact_id: contact.id,
      custom_attributes: customAttributes,
    });

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating Intercom user LikerPlus status:', error);
    return false;
  }
}

export default createIntercomToken;
