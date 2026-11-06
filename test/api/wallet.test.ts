import { describe, it, expect } from 'vitest';
import jsonStringify from 'fast-json-stable-stringify';
import jwt from 'jsonwebtoken';
import { personalSign } from '@metamask/eth-sig-util';
import { stringToHex } from 'viem';
import axiosist from './axiosist';
import { signWithPrivateKey as signWithCosmos } from './cosmos';
import {
  cosmosPrivateKeyNew,
  privateKey0,
  testingLikeWallet0,
  testingWallet0,
} from './data';
import { WALLET_AUTHORIZE_PERMISSIONS } from '../../src/constant/jwt';

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

function signAuthorize(permissions: unknown, expiresIn?: string) {
  const message = JSON.stringify({
    action: 'authorize',
    evmWallet: testingWallet0,
    permissions,
    ts: Date.now(),
  });
  const signature = personalSign({
    privateKey: Buffer.from(privateKey0.slice(2), 'hex'),
    data: stringToHex(message),
  });
  return {
    wallet: testingWallet0,
    signature,
    message,
    signMethod: 'personal_sign',
    expiresIn,
  };
}

describe('POST /wallet/authorize', () => {
  it('grants every allowlisted permission', async () => {
    const res = await post('/api/wallet/authorize', signAuthorize(WALLET_AUTHORIZE_PERMISSIONS, '30d'));
    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.data.token) as jwt.JwtPayload;
    expect(decoded.permissions).toEqual(WALLET_AUTHORIZE_PERMISSIONS);
    expect(decoded.exp! - decoded.iat!).toBe(30 * 24 * 60 * 60);
  });

  it('drops permissions outside the allowlist', async () => {
    const res = await post('/api/wallet/authorize', signAuthorize(['admin', 'read:admin', 'read', 'read:nftbook']));
    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.data.token) as jwt.JwtPayload;
    expect(decoded.permissions).toEqual(['read:nftbook']);
  });

  it('issues no permissions when the signed value is not a list', async () => {
    const res = await post('/api/wallet/authorize', signAuthorize('admin'));
    expect(res.status).toBe(200);
    expect((jwt.decode(res.data.token) as jwt.JwtPayload).permissions).toEqual([]);
  });

  it('rejects an expiresIn beyond 30d with 400', async () => {
    const res = await post('/api/wallet/authorize', signAuthorize(['read:nftbook'], '365d'));
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_INPUT');
  });
});
