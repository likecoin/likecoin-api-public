import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';

const ISCN_ID = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU/1';
const ISCN_ID_PREFIX = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU';
const CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';

describe('likernft: get mint info', () => {
  it('get mint info via iscn id', async () => {
    const res = await axiosist.get(`/api/likernft/mint?iscn_id=${ISCN_ID}`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.iscnId).toBe(ISCN_ID_PREFIX);
    expect(res.data.classId).toBe(CLASS_ID);
  });

  it('get mint info via class id', async () => {
    const res = await axiosist.get(`/api/likernft/mint?class_id=${CLASS_ID}`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.iscnId).toBe(ISCN_ID_PREFIX);
    expect(res.data.classId).toBe(CLASS_ID);
  });
});
