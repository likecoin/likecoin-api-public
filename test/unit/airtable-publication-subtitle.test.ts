import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { mockCreate, mockUpdate, mockFirstPage } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockFirstPage: vi.fn(),
}));

vi.mock('airtable', () => ({
  default: class {
    // eslint-disable-next-line class-methods-use-this
    base() {
      return () => ({
        create: mockCreate,
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
const {
  createAirtablePublicationRecord,
  updateAirtablePublicationRecord,
} = await import('../../src/util/airtable');

const CREATE_PARAMS = {
  id: '0xsubtitle',
  timestamp: new Date(),
  name: 'Book',
  description: '',
  ownerWallet: '0x0000000000000000000000000000000000000001',
  type: 'book',
  minPrice: 0,
  maxPrice: 0,
  imageURL: '',
};

function createdFields() {
  return mockCreate.mock.calls[0][0][0].fields;
}

function updatedFields() {
  return mockUpdate.mock.calls[0][1];
}

describe('Airtable publication Subtitle', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockFirstPage.mockReset();
    mockFirstPage.mockResolvedValue([{ id: 'rec1', fields: { ID: '0xsubtitle' } }]);
  });

  it('writes alternativeHeadline on create', async () => {
    await createAirtablePublicationRecord({ ...CREATE_PARAMS, alternativeHeadline: 'A Subtitle' });
    expect(createdFields().Subtitle).toBe('A Subtitle');
  });

  it('skips Subtitle on create without a string alternativeHeadline', async () => {
    await createAirtablePublicationRecord({ ...CREATE_PARAMS, alternativeHeadline: 42 as any });
    expect(createdFields()).not.toHaveProperty('Subtitle');
  });

  it('writes alternativeHeadline on update', async () => {
    await updateAirtablePublicationRecord({ id: '0xsubtitle', alternativeHeadline: 'New Subtitle' });
    expect(updatedFields().Subtitle).toBe('New Subtitle');
  });

  it('leaves Subtitle alone on update without alternativeHeadline', async () => {
    await updateAirtablePublicationRecord({ id: '0xsubtitle', isHidden: true });
    expect(updatedFields()).not.toHaveProperty('Subtitle');
  });
});
