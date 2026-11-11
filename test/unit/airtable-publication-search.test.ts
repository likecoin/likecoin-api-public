import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockSelect, mockFirstPage } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFirstPage: vi.fn(),
}));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return () => ({ select: mockSelect });
    }
  },
}));

// The Airtable base is only initialized outside test mode.
vi.mock('../../src/constant', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  TEST_MODE: false,
}));
vi.stubEnv('CI', '');

// eslint-disable-next-line import/first
const { queryAirtableForPublication } = await import('../../src/util/airtable');

describe('queryAirtableForPublication ISBN search', () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockFirstPage.mockReset();
    mockSelect.mockImplementation(() => ({ firstPage: mockFirstPage }));
    mockFirstPage.mockResolvedValue([]);
  });

  function selectedQuery() {
    const [options] = mockSelect.mock.calls[0];
    return options as { fields: string[]; filterByFormula: string };
  }

  it('searches ISBN along with the other default publication fields', async () => {
    await queryAirtableForPublication({ query: '9786266531625' });
    const { fields, filterByFormula } = selectedQuery();
    expect(fields).toEqual(expect.arrayContaining([
      'Name', 'Description', 'Author', 'ISBN',
    ]));
    expect(filterByFormula).toContain('LOWER({Name})');
    expect(filterByFormula).toContain('LOWER({Description})');
    expect(filterByFormula).toContain('LOWER({Owner Name})');
    expect(filterByFormula).toContain('LOWER({Author})');
    expect(filterByFormula).toContain('LOWER({Publisher})');
    expect(filterByFormula).toContain('LOWER({ISBN})');
  });

  it('searches only ISBN when fields=isbn, and still returns it', async () => {
    await queryAirtableForPublication({ query: '9786266531625', fields: ['isbn'] });
    const { fields, filterByFormula } = selectedQuery();
    expect(filterByFormula).toContain('LOWER({ISBN})');
    expect(filterByFormula).not.toContain('LOWER({Name})');
    expect(fields).toContain('ISBN');
  });

  it('does not search ISBN when the caller names other fields', async () => {
    await queryAirtableForPublication({ query: '9786266531625', fields: ['name'] });
    const { filterByFormula } = selectedQuery();
    expect(filterByFormula).toContain('LOWER({Name})');
    expect(filterByFormula).not.toContain('LOWER({ISBN})');
  });

  it('returns isbn with the other publication fields', async () => {
    mockFirstPage.mockResolvedValue([{
      fields: {
        ID: 'class-1',
        Name: 'Example',
        Author: 'Ada',
        ISBN: '978-626-653-162-5',
      },
    }]);
    const result = await queryAirtableForPublication({ query: '9786266531625' });
    expect(result).toEqual([expect.objectContaining({
      id: 'class-1',
      name: 'Example',
      author: 'Ada',
      isbn: '978-626-653-162-5',
    })]);
  });
});
