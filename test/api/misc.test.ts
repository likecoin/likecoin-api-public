import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';

describe('Misc API', () => {
  it('should get LikeCoin price (default)', async () => {
    const res = await axiosist.get('/api/misc/price')
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.price).toBeGreaterThanOrEqual(0);
  });
});
