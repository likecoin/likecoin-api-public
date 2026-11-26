import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockUpdate, mockFirstPage } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFirstPage: vi.fn(),
}));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return () => ({
        update: mockUpdate,
        select: () => ({ firstPage: mockFirstPage }),
      });
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
const { updateAirtablePublicationRecord } = await import('../../src/util/airtable');

const ID = '0xclassification';

function updatedFields() {
  return mockUpdate.mock.calls[0][1];
}

describe('Airtable publication Keywords and Genre on update', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockFirstPage.mockReset();
    mockFirstPage.mockResolvedValue([{
      id: 'rec1', fields: { ID, Keywords: ['old'], Genre: 'History' },
    }]);
  });

  it('writes non-empty values', async () => {
    await updateAirtablePublicationRecord({ id: ID, keywords: ['new'], genre: 'Fiction' });
    expect(updatedFields()).toMatchObject({ Keywords: ['new'], Genre: 'Fiction' });
  });

  it('keeps stored values when given empty or absent ones', async () => {
    await updateAirtablePublicationRecord({ id: ID, keywords: [], genre: '' });
    expect(updatedFields()).toMatchObject({ Keywords: ['old'], Genre: 'History' });
  });

  it('clears stored values when given null', async () => {
    await updateAirtablePublicationRecord({ id: ID, keywords: null, genre: null });
    expect(updatedFields()).toMatchObject({ Keywords: [], Genre: null });
  });
});
