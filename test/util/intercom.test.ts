import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockConfig, mockSearch, mockUpdate } = vi.hoisted(() => ({
  mockConfig: { INTERCOM_ACCESS_TOKEN: 'test-intercom-token', INTERCOM_API_SECRET: '' },
  mockSearch: vi.fn(),
  mockUpdate: vi.fn(),
}));

// Getters so a test can unset the token after intercom.ts has imported it.
vi.mock('../../config/config', () => ({
  get INTERCOM_ACCESS_TOKEN() { return mockConfig.INTERCOM_ACCESS_TOKEN; },
  get INTERCOM_API_SECRET() { return mockConfig.INTERCOM_API_SECRET; },
}));

vi.mock('intercom-client', () => ({
  IntercomClient: class {
    contacts = { search: mockSearch, update: mockUpdate };
  },
}));

const { updateIntercomUserName } = await import('../../src/util/intercom');

describe('updateIntercomUserName', () => {
  beforeEach(() => {
    mockConfig.INTERCOM_ACCESS_TOKEN = 'test-intercom-token';
    mockSearch.mockReset().mockResolvedValue({ data: [{ id: 'contact-1' }] });
    mockUpdate.mockReset().mockResolvedValue({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('updates the name of the contact found by external_id', async () => {
    await expect(updateIntercomUserName('alice', 'Alice')).resolves.toBe(true);
    expect(mockSearch).toHaveBeenCalledWith({
      query: { field: 'external_id', operator: '=', value: 'alice' },
    });
    expect(mockUpdate).toHaveBeenCalledWith({ contact_id: 'contact-1', name: 'Alice' });
  });

  it('skips when Intercom is not configured', async () => {
    mockConfig.INTERCOM_ACCESS_TOKEN = '';
    await expect(updateIntercomUserName('alice', 'Alice')).resolves.toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns false when the contact is not found', async () => {
    mockSearch.mockResolvedValue({ data: [] });
    await expect(updateIntercomUserName('alice', 'Alice')).resolves.toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when the update fails', async () => {
    mockUpdate.mockRejectedValue(new Error('Intercom down'));
    await expect(updateIntercomUserName('alice', 'Alice')).resolves.toBe(false);
  });
});
