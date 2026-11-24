import {
  describe, it, expect, vi,
} from 'vitest';
import type { LikerPlusData } from '../../src/types/user';

// test/setup.ts runs the suite as testnet; this file checks the production quarantine.
vi.mock('../../src/constant', async (importOriginal) => ({
  ...(await importOriginal() as object),
  IS_TESTNET: undefined,
}));

// eslint-disable-next-line import/first
const { isPlusReadingFunded } = await import('../../src/util/api/plus/revenueShare');

describe('isPlusReadingFunded on production', () => {
  const paid = { currentType: 'paid', dailyValue: 0.3, provider: 'revenuecat' } as LikerPlusData;

  it('rejects a sandbox store purchase', () => {
    expect(isPlusReadingFunded({ ...paid, environment: 'SANDBOX' })).toBe(false);
  });

  it('accepts a production store purchase', () => {
    expect(isPlusReadingFunded({ ...paid, environment: 'PRODUCTION' })).toBe(true);
  });
});
