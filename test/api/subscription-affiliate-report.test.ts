import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import mockEVMAddress from './address';

const PATH = '/api/likernft/book/user/subscription-affiliate/report';
const WALLET = mockEVMAddress(0x1111);

const get = (token?: string) => axiosist
  .get(PATH, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  .catch((err) => (err as any).response);

describe('GET /likernft/book/user/subscription-affiliate/report', () => {
  it('rejects requests without a token', async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });

  it('returns an empty report when the wallet has no payouts', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      payouts: [],
      summary: { totalCents: 0, subscriptionCount: 0 },
    });
  });
});
