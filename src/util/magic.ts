import { Magic, MagicUserMetadata, SDKError } from '@magic-sdk/admin';

import { MAGIC_SECRET_API_KEY } from '../../config/config';
import { ValidationError } from './ValidationError';

const MAGIC_TOKEN_VERIFICATION_FAILED = 'MAGIC_TOKEN_VERIFICATION_FAILED';

let magicInstance: Magic;

export async function getMagic(): Promise<Magic> {
  if (!magicInstance) {
    magicInstance = await Magic.init(MAGIC_SECRET_API_KEY);
  }
  return magicInstance;
}

export async function getMagicUserMetadataByDIDToken(didToken: string): Promise<MagicUserMetadata> {
  const magic = await getMagic();
  try {
    return await magic.users.getMetadataByToken(didToken);
  } catch (err) {
    // Magic SDK errors aren't ValidationErrors, so they'd surface as 500s and lose `data`.
    // Log the code/data for diagnosis and translate to a 401; verification fails closed.
    if (err instanceof SDKError) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        message: MAGIC_TOKEN_VERIFICATION_FAILED,
        code: err.code,
        data: err.data,
      }));
      throw new ValidationError(MAGIC_TOKEN_VERIFICATION_FAILED, 401);
    }
    throw err;
  }
}

export function verifyEmailByMagicUserMetadata(
  email: string,
  magicUserMetadata: MagicUserMetadata,
): boolean {
  return !!email && !!magicUserMetadata.email
    && email.toLowerCase() === magicUserMetadata.email.toLowerCase();
}

export async function verifyEmailByMagicDIDToken(
  email: string,
  didToken: string,
): Promise<boolean> {
  const magicUserMetadata = await getMagicUserMetadataByDIDToken(didToken);
  return verifyEmailByMagicUserMetadata(email, magicUserMetadata);
}
