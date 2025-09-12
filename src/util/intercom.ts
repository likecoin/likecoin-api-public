import jwt, { JwtPayload } from 'jsonwebtoken';
import { IntercomClient } from 'intercom-client';
import { CreateContactRequest } from 'intercom-client/api/types';
import {
  INTERCOM_API_SECRET,
  INTERCOM_ACCESS_TOKEN,
} from '../../config/config';

let intercomClient: IntercomClient | null = null;

/* eslint-disable camelcase */
interface IntercomUserCustomAttributes {
  evm_wallet?: string;
  like_wallet?: string;
  login_method?: string;
  is_liker_plus?: boolean;
  [key: string]: unknown;
}
/* eslint-enable camelcase */

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

async function findIntercomContactIdByUserId(userId: string): Promise<string | null> {
  const client = getIntercomClient();
  if (!client) return null;
  const searchResult = await client.contacts.search({
    query: {
      field: 'external_id',
      operator: '=',
      value: userId,
    },
  });

  const contact = searchResult.data?.[0];
  return contact?.id || null;
}

async function updateIntercomContact(
  contactId: string,
  customAttributes: IntercomUserCustomAttributes,
): Promise<boolean> {
  const client = getIntercomClient();
  if (!client) return false;
  await client.contacts.update({
    contact_id: contactId,
    custom_attributes: customAttributes,
  });
  return true;
}

export async function updateIntercomUserEvmWallet({
  userId,
  evmWallet,
}: {
  userId: string;
  evmWallet: string;
}): Promise<boolean> {
  try {
    const contactId = await findIntercomContactIdByUserId(userId);
    if (!contactId) {
      throw new Error(`Contact with external_id ${userId} not found for EVM wallet update`);
    }
    return await updateIntercomContact(contactId, {
      evm_wallet: evmWallet,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating Intercom user EVM wallet:', error);
    return false;
  }
}

export async function updateIntercomUserLikerPlusStatus({
  userId,
  isLikerPlus,
}: {
  userId: string;
  isLikerPlus: boolean;
}): Promise<boolean> {
  try {
    const contactId = await findIntercomContactIdByUserId(userId);
    if (!contactId) {
      throw new Error(`Contact with external_id ${userId} not found for LikerPlus status update`);
    }

    const customAttributes: Record<string, unknown> = {
      is_liker_plus: isLikerPlus,
    };

    return await updateIntercomContact(contactId, customAttributes);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating Intercom user LikerPlus status:', error);
    return false;
  }
}

export default createIntercomToken;
