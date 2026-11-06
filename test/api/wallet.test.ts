import { describe, it, expect } from 'vitest';
import jsonStringify from 'fast-json-stable-stringify';
import axiosist from './axiosist';
import { signWithPrivateKey as signWithCosmos } from './cosmos';
import { cosmosPrivateKeyNew, testingLikeWallet0 } from './data';

const post = (url: string, payload: Record<string, unknown>) => axiosist
  .post(url, payload)
  .catch((err) => (err as any).response);

describe('POST /wallet/evm/migrate/user', () => {
  it('returns 400 for a validly signed but malformed message', async () => {
    const {
      signed,
      signature: { signature, pub_key: publicKey },
    } = signWithCosmos('not a json payload', cosmosPrivateKeyNew);

    const res = await post('/api/wallet/evm/migrate/user', {
      cosmos_address: testingLikeWallet0,
      cosmos_signature: signature,
      cosmos_public_key: publicKey.value,
      cosmos_signature_content: jsonStringify(signed),
    });
    expect(res.status).toBe(400);
    expect(res.data).toBe('INVALID_PAYLOAD');
  });
});
