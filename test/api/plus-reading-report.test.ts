import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';

const PATH = '/api/likernft/book/user/plus-reading/report';
const WALLET = '0x1111111111111111111111111111111111111111';

const get = (query: string, token?: string) => axiosist
  .get(`${PATH}${query}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  .catch((err) => (err as any).response);

describe('GET /likernft/book/user/plus-reading/report', () => {
  it('rejects requests without a token', async () => {
    const res = await get('');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed period query', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get('?period=2026-3', token);
    expect(res.status).toBe(400);
  });

  it('returns an empty report when the wallet has no payouts', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get('', token);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      payouts: [],
      summary: {
        totalCents: 0,
        paidCents: 0,
        pendingCents: 0,
        periodCount: 0,
        bookCount: 0,
      },
    });
  });
});
