import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';

const ISCN_ID = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU/1';
const CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';

describe('likernft: query history', () => {
  it('query history via iscn id', async () => {
    const res = await axiosist.get(`/api/likernft/history?iscn_id=${ISCN_ID}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.list[0].txHash).toBe('5D5FA1727B20D84675FB6F98240712034E1ABDD04B400F9609093F092E2DAAF9');
  });

  it('query history via class id', async () => {
    const res = await axiosist.get(`/api/likernft/history?class_id=${CLASS_ID}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.list[0].txHash).toBe('5D5FA1727B20D84675FB6F98240712034E1ABDD04B400F9609093F092E2DAAF9');
  });
});
