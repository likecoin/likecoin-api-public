import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';

const PATH = '/api/likernft/book/user/plus-reading/stats';
const WALLET = '0x2222222222222222222222222222222222222222';

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
