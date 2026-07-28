import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import {
  likeNFTBookCMSTagCollection,
  likeNFTBookCollection,
} from '../../src/util/firebase';
import { makeTimestampFromMillis as ts } from '../stub/firebase';

const BASE_URL = '/api/likernft/book/store';
const AUTHORIZATION = { Authorization: 'Bearer test-airtable-automation-token' };

const BOOK_ID_ONE = mockEVMAddress(0x01);
const BOOK_ID_TWO = mockEVMAddress(0x02);
const BOOK_ID_A = mockEVMAddress(0x0a);
const BOOK_ID_B = mockEVMAddress(0x0b);
const BOOK_ID_C = mockEVMAddress(0x0c);
const BOOK_ID_D = mockEVMAddress(0x0d);
const BOOK_ID_MISSING = mockEVMAddress('dead');
const BOOK_ID_VISIBLE = mockEVMAddress(0x10);
const BOOK_ID_HIDDEN = mockEVMAddress(0x11);
const BOOK_ID_REDIRECTED = mockEVMAddress(0x12);

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

  it('defaults isForLibrary to false when omitted', async () => {
    const res = await post(`${BASE_URL}/cms/tags/featured`, tagBody(), AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCMSTagCollection.doc('featured').get()).data() as any;
    expect(data.isForLibrary).toBe(false);
  });

  it('stores isForLibrary:true when set in the payload', async () => {
    const res = await post(`${BASE_URL}/cms/tags/featured`, tagBody({ isForLibrary: true }), AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCMSTagCollection.doc('featured').get()).data() as any;
    expect(data.isForLibrary).toBe(true);
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
    await makeNFTBookStub(BOOK_ID_ONE, { cmsTags: { a: 50, b: 0 } });

    const res = await put(`${BASE_URL}/${BOOK_ID_ONE}/cms/tags`, { tagIds: ['a', 'c'] }, AUTHORIZATION);
    expect(res.status).toBe(200);

    const data = (await likeNFTBookCollection.doc(BOOK_ID_ONE).get()).data() as any;
    expect(data.cmsTags.a).toBe(50);
    expect(data.cmsTags.b).toBeUndefined();
    expect(data.cmsTags.c).toBe(0);
  });

  it('404s when the book does not exist', async () => {
    const res = await put(`${BASE_URL}/${BOOK_ID_MISSING}/cms/tags`, { tagIds: ['a'] }, AUTHORIZATION);
    expect(res.status).toBe(404);
  });

  it('clears all cmsTags when called with an empty tagIds array', async () => {
    await makeNFTBookStub(BOOK_ID_TWO, { cmsTags: { a: 0, b: 0 } });
    const res = await put(`${BASE_URL}/${BOOK_ID_TWO}/cms/tags`, { tagIds: [] }, AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCollection.doc(BOOK_ID_TWO).get()).data() as any;
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
    await makeNFTBookStub(BOOK_ID_A);
    await makeNFTBookStub(BOOK_ID_B);
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [
        { classId: BOOK_ID_A, tagId: 'feat', order: 10 },
        { classId: BOOK_ID_B, tagId: 'feat', order: 20 },
      ],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    expect(res.data.updated).toBe(2);

    const a = (await likeNFTBookCollection.doc(BOOK_ID_A).get()).data() as any;
    const b = (await likeNFTBookCollection.doc(BOOK_ID_B).get()).data() as any;
    expect(a.cmsTags.feat).toBe(10);
    expect(b.cmsTags.feat).toBe(20);
  });

  it('treats order:null as a delete of that tag entry', async () => {
    await makeNFTBookStub(BOOK_ID_C, { cmsTags: { feat: 10 } });
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [{ classId: BOOK_ID_C, tagId: 'feat', order: null }],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    const data = (await likeNFTBookCollection.doc(BOOK_ID_C).get()).data() as any;
    expect(data.cmsTags.feat).toBeUndefined();
  });

  it('skips missing classIds and returns errors map', async () => {
    await makeNFTBookStub(BOOK_ID_D);
    const res = await post(`${BASE_URL}/bulk/cms/tags`, {
      entries: [
        { classId: BOOK_ID_D, tagId: 'feat', order: 10 },
        { classId: BOOK_ID_MISSING, tagId: 'feat', order: 20 },
      ],
    }, AUTHORIZATION);
    expect(res.status).toBe(200);
    expect(res.data.updated).toBe(1);
    expect(res.data.errors).toHaveProperty(BOOK_ID_MISSING);
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

  it('returns isForLibrary:false for legacy docs missing the field', async () => {
    await likeNFTBookCMSTagCollection.doc('legacy').set(tagBody() as any);
    const res = await get(`${BASE_URL}/cms/tags/legacy`);
    expect(res.status).toBe(200);
    expect(res.data.isForLibrary).toBe(false);
  });

  it('returns isForLibrary:true when set via upsert', async () => {
    await post(`${BASE_URL}/cms/tags/lib`, tagBody({ isForLibrary: true }), AUTHORIZATION);
    const res = await get(`${BASE_URL}/cms/tags/lib`);
    expect(res.status).toBe(200);
    expect(res.data.isForLibrary).toBe(true);
  });
});

describe('GET /cms/list?tag=…', () => {
  it('excludes hidden and redirected books from the listing', async () => {
    await post(`${BASE_URL}/cms/tags/feat`, tagBody({ isPublic: true }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_VISIBLE, { cmsTags: { feat: 0 } });
    await makeNFTBookStub(BOOK_ID_HIDDEN, { cmsTags: { feat: 0 }, isHidden: true });
    await makeNFTBookStub(BOOK_ID_REDIRECTED, {
      cmsTags: { feat: 0 },
      redirectClassId: BOOK_ID_VISIBLE,
    });

    const res = await get(`${BASE_URL}/cms/list?tag=feat&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(BOOK_ID_VISIBLE);
    expect(ids).not.toContain(BOOK_ID_HIDDEN);
    expect(ids).not.toContain(BOOK_ID_REDIRECTED);
    expect(res.data).toHaveProperty('nextOffset');
  });

  it('excludes books that lack the requested tag entry', async () => {
    // Fresh address range: the stub's likeNFTBookCollection persists across tests in the same file,
    // so reusing earlier IDs (BOOK_ID_A/B/C) would leak their prior cmsTags state into this query.
    const BOOK_ID_TAGGED = mockEVMAddress(0x80);
    const BOOK_ID_OTHER_TAG = mockEVMAddress(0x81);
    const BOOK_ID_NO_TAGS = mockEVMAddress(0x82);
    await post(`${BASE_URL}/cms/tags/feat`, tagBody({ isPublic: true }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_TAGGED, { cmsTags: { feat: 0 } });
    await makeNFTBookStub(BOOK_ID_OTHER_TAG, { cmsTags: { other: 0 } });
    await makeNFTBookStub(BOOK_ID_NO_TAGS);

    const res = await get(`${BASE_URL}/cms/list?tag=feat&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(BOOK_ID_TAGGED);
    expect(ids).not.toContain(BOOK_ID_OTHER_TAG);
    expect(ids).not.toContain(BOOK_ID_NO_TAGS);
  });

  it('rejects an offset above the cap', async () => {
    const res = await get(`${BASE_URL}/cms/list?tag=feat&offset=10001&limit=10`);
    expect(res.status).toBe(400);
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

describe('CMS tag conditions (upsert + serialization)', () => {
  it('stores conditions and returns them with isConditional:true', async () => {
    const res = await post(`${BASE_URL}/cms/tags/conditional-tag`, tagBody({
      conditions: { publishers: ['出版社甲'], authors: ['作者乙'] },
    }), AUTHORIZATION);
    expect(res.status).toBe(200);

    const tag = (await get(`${BASE_URL}/cms/tags/conditional-tag`)).data;
    expect(tag.conditions).toEqual({
      publishers: ['出版社甲'], authors: ['作者乙'], genres: [], keywords: [],
    });
    expect(tag.isConditional).toBe(true);
  });

  it('returns isConditional:false for tags without conditions', async () => {
    await post(`${BASE_URL}/cms/tags/featured`, tagBody(), AUTHORIZATION);
    const tag = (await get(`${BASE_URL}/cms/tags/featured`)).data;
    expect(tag.isConditional).toBe(false);
  });

  it('clears conditions when upserted with conditions:{}', async () => {
    const path = `${BASE_URL}/cms/tags/conditional-tag`;
    await post(path, tagBody({ conditions: { publishers: ['出版社甲'] } }), AUTHORIZATION);
    await post(path, tagBody({ conditions: {} }), AUTHORIZATION);
    const tag = (await get(path)).data;
    expect(tag.conditions).toEqual({
      publishers: [], authors: [], genres: [], keywords: [],
    });
    expect(tag.isConditional).toBe(false);
  });

  it('normalizes conditions:null on hand-edited docs instead of failing serialization', async () => {
    await likeNFTBookCMSTagCollection.doc('legacy-null').set({
      ...tagBody(),
      conditions: null,
    } as any);
    const res = await get(`${BASE_URL}/cms/tags/legacy-null`);
    expect(res.status).toBe(200);
    expect(res.data.isConditional).toBe(false);
    expect(res.data.conditions).toEqual({
      publishers: [], authors: [], genres: [], keywords: [],
    });

    // The list endpoint serializes every tag; one bad doc must not 500 it.
    const listRes = await get(`${BASE_URL}/cms/tags`);
    expect(listRes.status).toBe(200);
    expect(listRes.data.list.map((t: any) => t.id)).toContain('legacy-null');
  });

  it('trims condition names and rejects whitespace-only entries', async () => {
    const path = `${BASE_URL}/cms/tags/conditional-tag`;
    const trimmed = await post(path, tagBody({
      conditions: { publishers: [' 出版社甲 '] },
    }), AUTHORIZATION);
    expect(trimmed.status).toBe(200);
    expect((await get(path)).data.conditions.publishers).toEqual(['出版社甲']);

    const blank = await post(path, tagBody({
      conditions: { publishers: ['   '] },
    }), AUTHORIZATION);
    expect(blank.status).toBe(400);
  });

  it('weights the budget: 2 per publisher/author name, 1 per genre/keyword', async () => {
    const path = `${BASE_URL}/cms/tags/conditional-tag`;
    const publishers = Array.from({ length: 13 }, (_, i) => `pub-${i}`);
    const within = await post(path, tagBody({
      // 13 × 2 + 2 + 2 = 30, exactly at the budget.
      conditions: { publishers, genres: ['g1', 'g2'], keywords: ['k1', 'k2'] },
    }), AUTHORIZATION);
    expect(within.status).toBe(200);

    const over = await post(path, tagBody({
      conditions: { publishers, genres: ['g1', 'g2'], keywords: ['k1', 'k2', 'k3'] },
    }), AUTHORIZATION);
    expect(over.status).toBe(400);
  });

  it('rejects conditions whose combined names exceed the cap', async () => {
    const within = await post(`${BASE_URL}/cms/tags/conditional-tag`, tagBody({
      conditions: {
        publishers: Array.from({ length: 12 }, (_, i) => `pub-${i}`),
        authors: Array.from({ length: 3 }, (_, i) => `auth-${i}`),
      },
    }), AUTHORIZATION);
    expect(within.status).toBe(200);

    const publishers = Array.from({ length: 8 }, (_, i) => `pub-${i}`);
    const authors = Array.from({ length: 8 }, (_, i) => `auth-${i}`);
    const res = await post(`${BASE_URL}/cms/tags/conditional-tag`, tagBody({
      conditions: { publishers, authors },
    }), AUTHORIZATION);
    expect(res.status).toBe(400);
  });
});

describe('GET /cms/list with conditions', () => {
  const PUB_A = '動態出版社';
  const AUTH_B = '動態作者';

  // Fresh address range; the stub's book collection persists across tests in this file.
  const BOOK_ID_MANUAL_FIRST = mockEVMAddress(0xa0);
  const BOOK_ID_MANUAL_SECOND = mockEVMAddress(0xa1);
  const BOOK_ID_BOTH = mockEVMAddress(0xa2);
  const BOOK_ID_PUB_STRING = mockEVMAddress(0xa3);
  const BOOK_ID_PUB_OBJ = mockEVMAddress(0xa4);
  const BOOK_ID_AUTH_STRING = mockEVMAddress(0xa5);
  const BOOK_ID_AUTH_OBJ = mockEVMAddress(0xa6);
  const BOOK_ID_NO_MATCH = mockEVMAddress(0xa7);

  async function seedConditionBooks() {
    await post(`${BASE_URL}/cms/tags/conditional`, tagBody({
      conditions: { publishers: [PUB_A], authors: [AUTH_B] },
    }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_MANUAL_FIRST, {
      cmsTags: { conditional: 0 },
      timestamp: ts(100),
    });
    await makeNFTBookStub(BOOK_ID_MANUAL_SECOND, {
      cmsTags: { conditional: 1 },
      timestamp: ts(500),
    });
    await makeNFTBookStub(BOOK_ID_BOTH, {
      cmsTags: { conditional: 2 },
      publisher: PUB_A,
      timestamp: ts(5000),
    });
    await makeNFTBookStub(BOOK_ID_PUB_STRING, { publisher: PUB_A, timestamp: ts(3000) });
    await makeNFTBookStub(BOOK_ID_PUB_OBJ, { publisher: { name: PUB_A }, timestamp: ts(1000) });
    await makeNFTBookStub(BOOK_ID_AUTH_STRING, { author: AUTH_B, timestamp: ts(2000) });
    await makeNFTBookStub(BOOK_ID_AUTH_OBJ, { author: { name: AUTH_B }, timestamp: ts(4000) });
    await makeNFTBookStub(BOOK_ID_NO_MATCH, { publisher: '別家出版社', timestamp: ts(9000) });
  }

  it('lists handpicked books first (curated order), then condition matches by timestamp desc', async () => {
    await seedConditionBooks();
    const res = await get(`${BASE_URL}/cms/list?tag=conditional&limit=10`);
    expect(res.status).toBe(200);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([
      BOOK_ID_MANUAL_FIRST,
      BOOK_ID_MANUAL_SECOND,
      BOOK_ID_BOTH,
      BOOK_ID_AUTH_OBJ,
      BOOK_ID_PUB_STRING,
      BOOK_ID_AUTH_STRING,
      BOOK_ID_PUB_OBJ,
    ]);
  });

  it('paginates across the handpicked/condition-matched boundary with a stable nextOffset', async () => {
    await seedConditionBooks();
    const first = await get(`${BASE_URL}/cms/list?tag=conditional&limit=5&offset=0`);
    expect(first.data.list.map((b: any) => b.classId)).toEqual([
      BOOK_ID_MANUAL_FIRST,
      BOOK_ID_MANUAL_SECOND,
      BOOK_ID_BOTH,
      BOOK_ID_AUTH_OBJ,
      BOOK_ID_PUB_STRING,
    ]);
    expect(first.data.nextOffset).toBe(5);

    const second = await get(`${BASE_URL}/cms/list?tag=conditional&limit=5&offset=5`);
    expect(second.data.list.map((b: any) => b.classId)).toEqual([
      BOOK_ID_AUTH_STRING,
      BOOK_ID_PUB_OBJ,
    ]);
    expect(second.data.nextOffset).toBe(null);
  });

  it('excludes hidden and redirected condition matches', async () => {
    const BOOK_ID_HIDDEN_MATCH = mockEVMAddress(0xb0);
    const BOOK_ID_REDIRECTED_MATCH = mockEVMAddress(0xb1);
    const BOOK_ID_VISIBLE_MATCH = mockEVMAddress(0xb2);
    await post(`${BASE_URL}/cms/tags/conditional-vis`, tagBody({
      conditions: { publishers: ['vis-pub'] },
    }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_HIDDEN_MATCH, {
      publisher: 'vis-pub',
      isHidden: true,
      timestamp: ts(300),
    });
    await makeNFTBookStub(BOOK_ID_REDIRECTED_MATCH, {
      publisher: 'vis-pub',
      redirectClassId: BOOK_ID_VISIBLE_MATCH,
      timestamp: ts(200),
    });
    await makeNFTBookStub(BOOK_ID_VISIBLE_MATCH, { publisher: 'vis-pub', timestamp: ts(100) });

    const res = await get(`${BASE_URL}/cms/list?tag=conditional-vis&limit=10`);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_VISIBLE_MATCH]);
  });

  it('keeps only Plus-reading books when library=1', async () => {
    const BOOK_ID_PLUS = mockEVMAddress(0xb3);
    const BOOK_ID_NO_PLUS = mockEVMAddress(0xb4);
    await post(`${BASE_URL}/cms/tags/conditional-lib`, tagBody({
      conditions: { publishers: ['lib-pub'] },
    }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_PLUS, { publisher: 'lib-pub', isPlusReadingEnabled: true, timestamp: ts(200) });
    await makeNFTBookStub(BOOK_ID_NO_PLUS, { publisher: 'lib-pub', timestamp: ts(100) });

    const res = await get(`${BASE_URL}/cms/list?tag=conditional-lib&library=1&limit=10`);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_PLUS]);
  });

  it('treats malformed hand-edited conditions as non-conditional', async () => {
    const BOOK_ID_LEGACY = mockEVMAddress(0xb6);
    await likeNFTBookCMSTagCollection.doc('legacy-cond').set({
      ...tagBody(),
      conditions: { publishers: 'not-an-array', authors: 42 },
    } as any);
    await makeNFTBookStub(BOOK_ID_LEGACY, { cmsTags: { 'legacy-cond': 0 } });

    const tagRes = await get(`${BASE_URL}/cms/tags/legacy-cond`);
    expect(tagRes.status).toBe(200);
    expect(tagRes.data.isConditional).toBe(false);
    expect(tagRes.data.conditions).toEqual({
      publishers: [], authors: [], genres: [], keywords: [],
    });

    const listRes = await get(`${BASE_URL}/cms/list?tag=legacy-cond&limit=10`);
    expect(listRes.status).toBe(200);
    expect(listRes.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_LEGACY]);
  });

  it('trims hand-edited condition names and drops whitespace-only entries', async () => {
    const BOOK_ID_HAND_TRIMMED = mockEVMAddress(0xc0);
    await likeNFTBookCMSTagCollection.doc('legacy-trim').set({
      ...tagBody(),
      conditions: { publishers: [' hand-pub ', '   '], authors: [] },
    } as any);
    await makeNFTBookStub(BOOK_ID_HAND_TRIMMED, { publisher: 'hand-pub', timestamp: ts(100) });

    const tagRes = await get(`${BASE_URL}/cms/tags/legacy-trim`);
    expect(tagRes.data.conditions).toEqual({
      publishers: ['hand-pub'], authors: [], genres: [], keywords: [],
    });
    expect(tagRes.data.isConditional).toBe(true);

    const listRes = await get(`${BASE_URL}/cms/list?tag=legacy-trim&limit=10`);
    expect(listRes.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_HAND_TRIMMED]);
  });

  it('caps hand-edited condition names at the combined cap', async () => {
    const BOOK_ID_WITHIN_CAP = mockEVMAddress(0xb7);
    const BOOK_ID_BEYOND_CAP = mockEVMAddress(0xb8);
    const publishers = Array.from({ length: 16 }, (_, i) => `cap-pub-${i}`);
    await likeNFTBookCMSTagCollection.doc('legacy-cap').set({
      ...tagBody(),
      conditions: { publishers, authors: [] },
    } as any);
    await makeNFTBookStub(BOOK_ID_WITHIN_CAP, { publisher: 'cap-pub-0', timestamp: ts(200) });
    await makeNFTBookStub(BOOK_ID_BEYOND_CAP, { publisher: 'cap-pub-15', timestamp: ts(100) });

    const res = await get(`${BASE_URL}/cms/list?tag=legacy-cap&limit=10`);
    expect(res.status).toBe(200);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_WITHIN_CAP]);
  });

  it('matches books by genre and keyword conditions', async () => {
    const BOOK_ID_GENRE = mockEVMAddress(0xd2);
    const BOOK_ID_KEYWORD = mockEVMAddress(0xd3);
    const BOOK_ID_NO_META_MATCH = mockEVMAddress(0xd4);
    await post(`${BASE_URL}/cms/tags/conditional-meta`, tagBody({
      conditions: { genres: ['科幻'], keywords: ['太空'] },
    }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_GENRE, { genre: '科幻', timestamp: ts(200) });
    await makeNFTBookStub(BOOK_ID_KEYWORD, { keywords: ['太空', '冒險'], timestamp: ts(100) });
    await makeNFTBookStub(BOOK_ID_NO_META_MATCH, {
      genre: '愛情',
      keywords: ['浪漫'],
      timestamp: ts(300),
    });

    const res = await get(`${BASE_URL}/cms/list?tag=conditional-meta&limit=10`);
    expect(res.status).toBe(200);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([
      BOOK_ID_GENRE,
      BOOK_ID_KEYWORD,
    ]);
  });

  it('lists a book matching both publisher and author conditions only once', async () => {
    const BOOK_ID_PUB_AND_AUTH = mockEVMAddress(0xb5);
    await post(`${BASE_URL}/cms/tags/conditional-overlap`, tagBody({
      conditions: { publishers: ['overlap-pub'], authors: ['overlap-auth'] },
    }), AUTHORIZATION);
    await makeNFTBookStub(BOOK_ID_PUB_AND_AUTH, {
      publisher: 'overlap-pub',
      author: 'overlap-auth',
      timestamp: ts(100),
    });

    const res = await get(`${BASE_URL}/cms/list?tag=conditional-overlap&limit=10`);
    expect(res.data.list.map((b: any) => b.classId)).toEqual([BOOK_ID_PUB_AND_AUTH]);
  });
});
