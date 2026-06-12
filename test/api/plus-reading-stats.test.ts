import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import mockEVMAddress from './address';

const PATH = '/api/likernft/book/user/plus-reading/stats';
const WALLET = mockEVMAddress(0x2222);

const get = (query: string, token?: string) => axiosist
  .get(`${PATH}${query}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  .catch((err) => (err as any).response);

describe('GET /likernft/book/user/plus-reading/stats', () => {
  it('rejects requests without a token', async () => {
    const res = await get('');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed period query', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get('?period=2026-3', token);
    expect(res.status).toBe(400);
  });

  it('rejects a malformed classId query', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get('?classId=not-an-address', token);
    expect(res.status).toBe(400);
  });

  it('returns empty stats when the wallet owns no books', async () => {
    const token = jwtSign({ wallet: WALLET });
    const res = await get('', token);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      stats: [],
      summary: {
        totalReadingTimeMs: 0,
        totalTTSTimeMs: 0,
        bookCount: 0,
        periodCount: 0,
      },
    });
  });
});
