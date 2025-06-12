import { Magic, MagicUserMetadata } from '@magic-sdk/admin';

import { MAGIC_SECRET_API_KEY } from '../../config/config';

let magicInstance: Magic;

export async function getMagic(): Promise<Magic> {
  if (!magicInstance) {
    magicInstance = await Magic.init(MAGIC_SECRET_API_KEY);
  }
  return magicInstance;
}

export async function getMagicUserMetadataById(userId: string): Promise<MagicUserMetadata> {
  const magic = await getMagic();
  return magic.users.getMetadataByIssuer(userId);
}
