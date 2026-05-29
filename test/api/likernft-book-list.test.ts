import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection } from '../../src/util/firebase';

const BASE_URL = '/api/likernft/book/store';

const ID_DRM_FREE = mockEVMAddress(0x20);
const ID_DRM_HIDDEN = mockEVMAddress(0x21);
const ID_DEFAULT = mockEVMAddress(0x22);
const ID_VISIBLE = mockEVMAddress(0x30);
const ID_HIDDEN = mockEVMAddress(0x31);
const ID_REDIRECTED = mockEVMAddress(0x32);

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

describe('GET /list/drm-free', () => {
  it('returns only books where hideDownload === false', async () => {
    await makeNFTBookStub(ID_DRM_FREE, { hideDownload: false });
    await makeNFTBookStub(ID_DRM_HIDDEN, { hideDownload: true });
    // Books with no hideDownload field are excluded:
    // the query `where('hideDownload','==',false)` skips absent-field docs.
    await makeNFTBookStub(ID_DEFAULT);

    const res = await get(`${BASE_URL}/list/drm-free?limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_DRM_FREE);
    expect(ids).not.toContain(ID_DRM_HIDDEN);
    expect(ids).not.toContain(ID_DEFAULT);
    expect(res.data).toHaveProperty('nextKey');
  });

  it('excludes hidden and redirected books from the response', async () => {
    await makeNFTBookStub(ID_VISIBLE, { hideDownload: false });
    await makeNFTBookStub(ID_HIDDEN, { hideDownload: false, isHidden: true });
    await makeNFTBookStub(ID_REDIRECTED, { hideDownload: false, redirectClassId: ID_VISIBLE });

    const res = await get(`${BASE_URL}/list/drm-free?limit=10`);
    expect(res.status).toBe(200);
    const ids = res.data.list.map((b: any) => b.classId);
    expect(ids).toContain(ID_VISIBLE);
    expect(ids).not.toContain(ID_HIDDEN);
    expect(ids).not.toContain(ID_REDIRECTED);
  });
});
