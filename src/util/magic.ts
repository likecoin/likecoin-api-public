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
    // Magic SDK errors (expired/malformed token, or SERVICE_ERROR from the Magic
    // API) are not ValidationErrors, so they would surface as an opaque 500 and
    // the nested `data` cause would be lost. Log the cause for diagnosis, then
    // translate to a clean 401. Fails closed: email stays unverified on failure.
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
  return !!magicUserMetadata.email && email === magicUserMetadata.email;
}

export async function verifyEmailByMagicDIDToken(
  email: string,
  didToken: string,
): Promise<boolean> {
  const magicUserMetadata = await getMagicUserMetadataByDIDToken(didToken);
  return verifyEmailByMagicUserMetadata(email, magicUserMetadata);
}
