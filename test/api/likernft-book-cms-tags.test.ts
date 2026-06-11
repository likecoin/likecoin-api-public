import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import {
  likeNFTBookCMSTagCollection,
  likeNFTBookCollection,
} from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';
const AUTHORIZATION = { Authorization: 'Bearer test-airtable-automation-token' };

const ID_ONE = mockEVMAddress(0x01);
const ID_TWO = mockEVMAddress(0x02);
const ID_A = mockEVMAddress(0x0a);
const ID_B = mockEVMAddress(0x0b);
const ID_C = mockEVMAddress(0x0c);
const ID_D = mockEVMAddress(0x0d);
const ID_MISSING = mockEVMAddress('dead');
const ID_VISIBLE = mockEVMAddress(0x10);
const ID_HIDDEN = mockEVMAddress(0x11);
const ID_REDIRECTED = mockEVMAddress(0x12);

const tagBody = (overrides: Record<string, unknown> = {}) => ({
  name: { zh: '精選', en: 'Featured' },
  description: { zh: '精選描述', en: 'Featured description' },
  order: '10',
  isPublic: true,
  ...overrides,
});

const post = (path: string, body: unknown, headers?: Record<string, string>) => axiosist
  .post(path, body, headers ? { headers } : undefined)
  .catch((err: any) => err.response);

const put = (path: string, body: unknown, headers?: Record<string, string>) => axiosist
  .put(path, body, headers ? { headers } : undefined)
  .catch((err: any) => err.response);

const get = (path: string) => axiosist
  .get(path)
  .catch((err: any) => err.response);

async function makeNFTBookStub(classId: string, overrides: Record<string, unknown> = {}) {
  await likeNFTBookCollection.doc(classId).set({
    classId,
    ownerWallet: 'wallet1',
    prices: [],
    ...overrides,
  } as any);
}

describe('airtableAutomationAuth middleware', () => {
  const path = `${BASE_URL}/cms/tags/featured`;

  it('rejects requests with no Authorization header', async () => {
    const res = await post(path, tagBody());
    expect(res.status).toBe(401);
  });

  it('rejects requests without the Bearer prefix', async () => {
    const res = await post(path, tagBody(), { Authorization: 'test-airtable-automation-token' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong Bearer token', async () => {
    const res = await post(path, tagBody(), { Authorization: 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  });

  it('accepts a matching Bearer token', async () => {
    const res = await post(path, tagBody(), AUTHORIZATION);
    expect(res.status).toBe(200);
    const snap = await likeNFTBookCMSTagCollection.doc('featured').get();
    expect(snap.exists).toBe(true);
  });
});

describe('POST /cms/tags/:tagId (upsert)', () => {
  it('creates the tag doc with timestamp + lastUpdateTimestamp on first call', async () => {
    const res = await post(`${BASE_URL}/cms/tags/featured`, tagBody({ order: '10' }), AUTHORIZATION);
    expect(res.status).toBe(200);

    const snap = await likeNFTBookCMSTagCollection.doc('featured').get();
    const data = snap.data() as any;
    expect(data.order).toBe('10');
    expect(data.name).toEqual({ zh: '精選', en: 'Featured' });
    expect(data.isPublic).toBe(true);
    expect(data.timestamp).toBeTruthy();
    expect(data.lastUpdateTimestamp).toBeTruthy();
  });

  it('merges on subsequent call: updates fields without overwriting the original timestamp', async () => {
    const path = `${BASE_URL}/cms/tags/featured`;
    await post(path, tagBody({ order: '10' }), AUTHORIZATION);
    const first = (await likeNFTBookCMSTagCollection.doc('featured').get()).data() as any;
    const originalTimestampMs = first.timestamp.toMillis();

    await post(path, tagBody({ order: '20' }), AUTHORIZATION);
    const after = (await likeNFTBookCMSTagCollection.doc('featured').get()).data() as any;
    expect(after.order).toBe('20');
    // First-write timestamp preserved across merge updates.
    expect(after.timestamp.toMillis()).toBe(originalTimestampMs);
  });
});

describe('PUT /:classId/cms/tags (membership sync)', () => {
  it('adds new tagIds with order 0, removes missing tagIds, and preserves existing orders', async () => {
    await makeNFTBookStub(ID_ONE, { cmsTags: { a: 50, b: 0 } });

    const res = await put(`${BASE_URL}/${ID_ONE}/cms/tags`, { tagIds: ['a', 'c'] }, AUTHORIZATION);
    expect(res.status).toBe(200);

    const data = (await likeNFTBookCollection.doc(ID_ONE).get()).data() as any;
    expect(data.cmsTags.a).toBe(50);
    expect(data.cmsTags.b).toBeUndefined();
    expect(data.cmsTags.c).toBe(0);
  });

  it('404s when the book does not exist', async () => {
    const res = await put(`${BASE_URL}/${ID_MISSING}/cms/tags`, { tagIds: ['a'] }, AUTHORIZATION);
    expect(res.status).toBe(404);
  });

  it('clears all cmsTags when called with an empty tagIds array', async () => {
    await makeNFTBookStub(ID_TWO, { cmsTags: { a: 0, b: 0 } });
    const res = await put(`${BASE_URL}/${ID_TWO}/cms/tags`, { tagIds: [] }, AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCollection.doc(ID_TWO).get()).data() as any;
    expect(data.cmsTags || {}).toEqual({});
  });
});

describe('POST /bulk/cms/tags', () => {
  it('returns updated:0 for an empty entries array', async () => {
    const res = await post(`${BASE_URL}/bulk/cms/tags`, { entries: [] }, AUTHORIZATION);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ updated: 0 });
  });

  it('writes order values for each classId in the batch', async () => {
    await makeNFTBookStub(ID_A);
    await makeNFTBookStub(ID_B);
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [
        { classId: ID_A, tagId: 'feat', order: 10 },
        { classId: ID_B, tagId: 'feat', order: 20 },
      ],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    expect(res.data.updated).toBe(2);

    const a = (await likeNFTBookCollection.doc(ID_A).get()).data() as any;
    const b = (await likeNFTBookCollection.doc(ID_B).get()).data() as any;
    expect(a.cmsTags.feat).toBe(10);
    expect(b.cmsTags.feat).toBe(20);
  });

  it('treats order:null as a delete of that tag entry', async () => {
    await makeNFTBookStub(ID_C, { cmsTags: { feat: 10 } });
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [{ classId: ID_C, tagId: 'feat', order: null }],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCollection.doc(ID_C).get()).data() as any;
    expect(data.cmsTags.feat).toBeUndefined();
  });

  it('skips missing classIds and returns errors map', async () => {
    await makeNFTBookStub(ID_D);
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [
        { classId: ID_D, tagId: 'feat', order: 10 },
        { classId: ID_MISSING, tagId: 'feat', order: 20 },
      ],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    expect(res.data.updated).toBe(1);
    expect(res.data.errors).toHaveProperty(ID_MISSING);
  });
});

describe('GET /cms/tags (public list)', () => {
  it('returns the seeded tags', async () => {
    await post(`${BASE_URL}/cms/tags/featured`, tagBody({ order: '10' }), AUTHORIZATION);
    await post(`${BASE_URL}/cms/tags/staff-picks`, tagBody({ order: '20' }), AUTHORIZATION);

    const res = await get(`${BASE_URL}/cms/tags`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['featured', 'staff-picks']));
  });

  it('serializes timestamp + lastUpdateTimestamp as millis numbers', async () => {
    await post(`${BASE_URL}/cms/tags/featured`, tagBody(), AUTHORIZATION);
    const res = await get(`${BASE_URL}/cms/tags`);
    const tag = res.data.list.find((t: any) => t.id === 'featured');
    expect(typeof tag.timestamp).toBe('number');
    expect(typeof tag.lastUpdateTimestamp).toBe('number');
  });
});

describe('GET /cms/tags/:tagId (single fetch)', () => {
  it('returns the tag with timestamps as millis numbers', async () => {
    await post(`${BASE_URL}/cms/tags/featured`, tagBody(), AUTHORIZATION);
    const res = await get(`${BASE_URL}/cms/tags/featured`);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe('featured');
    expect(typeof res.data.timestamp).toBe('number');
    expect(typeof res.data.lastUpdateTimestamp).toBe('number');
  });

  it('404s when the tag is missing', async () => {
    const res = await get(`${BASE_URL}/cms/tags/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe('GET /cms/list?tag=…', () => {
  it('excludes hidden and redirected books from the listing', async () => {
    await post(`${BASE_URL}/cms/tags/feat`, tagBody({ isPublic: true }), AUTHORIZATION);
    await makeNFTBookStub(ID_VISIBLE, { cmsTags: { feat: 0 } });
    await makeNFTBookStub(ID_HIDDEN, { cmsTags: { feat: 0 }, isHidden: true });
    await makeNFTBookStub(ID_REDIRECTED, { cmsTags: { feat: 0 }, redirectClassId: ID_VISIBLE });

    const res = await get(`${BASE_URL}/cms/list?tag=feat&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_VISIBLE);
    expect(ids).not.toContain(ID_HIDDEN);
    expect(ids).not.toContain(ID_REDIRECTED);
    expect(res.data).toHaveProperty('nextOffset');
  });

  it('excludes books that lack the requested tag entry', async () => {
    // Fresh address range: the stub's likeNFTBookCollection persists across tests in the same file,
    // so reusing earlier IDs (ID_A/B/C) would leak their prior cmsTags state into this query.
    const ID_TAGGED = mockEVMAddress(0x80);
    const ID_OTHER_TAG = mockEVMAddress(0x81);
    const ID_NO_TAGS = mockEVMAddress(0x82);
    await post(`${BASE_URL}/cms/tags/feat`, tagBody({ isPublic: true }), AUTHORIZATION);
    await makeNFTBookStub(ID_TAGGED, { cmsTags: { feat: 0 } });
    await makeNFTBookStub(ID_OTHER_TAG, { cmsTags: { other: 0 } });
    await makeNFTBookStub(ID_NO_TAGS);

    const res = await get(`${BASE_URL}/cms/list?tag=feat&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_TAGGED);
    expect(ids).not.toContain(ID_OTHER_TAG);
    expect(ids).not.toContain(ID_NO_TAGS);
  });

  it('404s when the tag does not exist', async () => {
    await makeNFTBookStub(mockEVMAddress(0x90), { cmsTags: { secret: 0 } });
    const res = await get(`${BASE_URL}/cms/list?tag=secret&limit=10`);
    expect(res.status).toBe(404);
  });

  it('lists books when the tag exists but is marked isPublic:false', async () => {
    await post(`${BASE_URL}/cms/tags/private`, tagBody({ isPublic: false }), AUTHORIZATION);
    const classId = mockEVMAddress(0x91);
    await makeNFTBookStub(classId, { cmsTags: { private: 0 } });
    const res = await get(`${BASE_URL}/cms/list?tag=private&limit=10`);
    expect(res.status).toBe(200);
    expect(res.data.list.map((b: any) => b.classId)).toContain(classId);
  });
});
