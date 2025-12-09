import jwt, { JwtPayload } from 'jsonwebtoken';
import { IntercomClient } from 'intercom-client';
import { Contact, CreateContactRequest, UpdateContactRequest } from 'intercom-client/api';
import {
  INTERCOM_API_SECRET,
  INTERCOM_ACCESS_TOKEN,
} from '../../config/config';

let intercomClient: IntercomClient | null = null;

/* eslint-disable camelcase */
export interface IntercomUserCustomAttributes {
  evm_wallet?: string;
  like_wallet?: string;
  login_method?: string;
  is_liker_plus?: boolean;
  is_liker_plus_trial?: boolean;
  has_claimed_free_book?: boolean;
  has_purchased_paid_book?: boolean;
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

async function findIntercomLeadByEmail(
  email: string,
): Promise<Contact | null> {
  const client = getIntercomClient();
  if (!client) return null;

  try {
    const searchResult = await client.contacts.search({
      query: {
        operator: 'AND',
        value: [{
          field: 'email',
          operator: '=',
          value: email,
        }, {
          field: 'role',
          operator: '=',
          value: 'lead',
        }],
      },
    });

    const lead = searchResult.data?.[0];
    return lead || null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error searching for Intercom lead:', error);
    return null;
  }
}

async function promoteIntercomLead(
  leadId: string,
  userData: UpdateContactRequest,
): Promise<boolean> {
  const client = getIntercomClient();
  if (!client) return false;

  try {
    await client.contacts.update({
      contact_id: leadId,
      role: 'user',
      external_id: userData.external_id,
      name: userData.name,
      signed_up_at: userData.signed_up_at,
      custom_attributes: userData.custom_attributes,
      avatar: userData.avatar,
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error promoting Intercom lead:', error);
    return false;
  }
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
        ...(evmWallet && { evm_wallet: evmWallet }),
      },
    };

    if (email) {
      // Search for existing lead with the same email and promote if found
      const existingLead = await findIntercomLeadByEmail(email);
      if (existingLead) {
        return await promoteIntercomLead(existingLead.id, userData as UpdateContactRequest);
      }
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

export async function updateIntercomUserAttributes(
  userId: string,
  customAttributes: IntercomUserCustomAttributes,
): Promise<boolean> {
  try {
    const contactId = await findIntercomContactIdByUserId(userId);
    if (!contactId) {
      throw new Error(`Contact with external_id ${userId} not found for attributes update`);
    }
    return await updateIntercomContact(contactId, customAttributes);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating Intercom user attributes:', error);
    return false;
  }
}

export async function sendIntercomEvent({
  userId,
  eventName,
  metadata = {},
}: {
  userId: string;
  eventName: string;
  metadata?: Record<string, string | number>;
}): Promise<boolean> {
  const client = getIntercomClient();
  if (!client) return false;

  try {
    await client.events.create({
      event_name: eventName,
      created_at: Math.floor(Date.now() / 1000),
      user_id: userId,
      metadata: metadata as Record<string, string>,
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error sending Intercom event:', error);
    return false;
  }
}

export default createIntercomToken;
