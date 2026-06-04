import { describe, it, expect } from 'vitest';
import { checksumAddress } from 'viem';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { userCollection } from '../../src/util/firebase';

const SECRET = 'test-alchemy-webhook-secret';
const POLICY_ID = 'test-alchemy-policy-id';
const CHAIN_ID = 84532; // IS_TESTNET in tests → Base Sepolia
const BASE_URL = `/api/likernft/book/sponsorship/verify/${SECRET}`;

const REGISTERED_ADDR = mockEVMAddress(0xb001);
const UNREGISTERED_ADDR = mockEVMAddress(0xb002);

async function makeUser(id: string, evmWallet: string) {
  // Stored checksummed in userCollection, matching how the app persists evmWallet.
  await userCollection.doc(id).set({
    evmWallet: checksumAddress(evmWallet as `0x${string}`),
  } as any);
}

const post = (path: string, body: any) => axiosist
  .post(path, body)
  .catch((err: any) => err.response);

describe('POST /likernft/book/sponsorship/verify/:secret', () => {
  it('approves a registered user (sender normalised by checksum)', async () => {
    await makeUser('user1registered', REGISTERED_ADDR);
    const res = await post(BASE_URL, {
      userOperation: { sender: REGISTERED_ADDR }, // lowercase on the wire
      policyId: POLICY_ID,
      chainId: CHAIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: true });
  });

  it('rejects an unregistered sender with HTTP 200 (not an error status)', async () => {
    const res = await post(BASE_URL, {
      userOperation: { sender: UNREGISTERED_ADDR },
      policyId: POLICY_ID,
      chainId: CHAIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: false });
  });

  it('rejects a policy id mismatch with HTTP 200', async () => {
    await makeUser('user1registered', REGISTERED_ADDR);
    const res = await post(BASE_URL, {
      userOperation: { sender: REGISTERED_ADDR },
      policyId: 'some-other-policy',
      chainId: CHAIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: false });
  });

  it('rejects a chain id mismatch with HTTP 200', async () => {
    await makeUser('user1registered', REGISTERED_ADDR);
    const res = await post(BASE_URL, {
      userOperation: { sender: REGISTERED_ADDR },
      policyId: POLICY_ID,
      chainId: 8453, // Base mainnet, not the testnet chain tests expect
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: false });
  });

  it('rejects (200) rather than 400-ing when sender is missing', async () => {
    const res = await post(BASE_URL, {
      userOperation: {},
      policyId: POLICY_ID,
      chainId: CHAIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: false });
  });

  it('fails closed (200 { approved: false }) when the URL secret is wrong', async () => {
    await makeUser('user1registered', REGISTERED_ADDR);
    const res = await post('/api/likernft/book/sponsorship/verify/wrong-secret', {
      userOperation: { sender: REGISTERED_ADDR },
      policyId: POLICY_ID,
      chainId: CHAIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ approved: false });
  });
});
