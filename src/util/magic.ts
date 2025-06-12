import { Magic, MagicUserMetadata } from '@magic-sdk/admin';

import { ValidationError } from './ValidationError';
import { MAGIC_SECRET_API_KEY } from '../../config/config';

let magicInstance: Magic;

export async function getMagic(): Promise<Magic> {
  if (!magicInstance) {
    magicInstance = await Magic.init(MAGIC_SECRET_API_KEY);
  }
  return magicInstance;
}

export async function getMagicUserMetadataByDIDToken(didToken: string): Promise<MagicUserMetadata> {
  const magic = await getMagic();
  return magic.users.getMetadataByToken(didToken);
}

export function verifyEmailByMagicUserMetadata(
  email: string,
  magicUserMetadata: MagicUserMetadata,
): boolean {
  if (!magicUserMetadata.email) {
    return false;
  }
  if (email !== magicUserMetadata.email) {
    throw new ValidationError('MAGIC_EMAIL_MISMATCH');
  }
  return true;
}

export async function verifyEmailByMagicDIDToken(
  email: string,
  didToken: string,
): Promise<boolean> {
  const magicUserMetadata = await getMagicUserMetadataByDIDToken(didToken);
  return verifyEmailByMagicUserMetadata(email, magicUserMetadata);
}
