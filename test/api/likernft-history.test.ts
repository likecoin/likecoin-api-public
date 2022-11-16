import test from 'ava';
import axiosist from './axiosist';

const ISCN_ID = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU/1';
const CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';

test('likernft: query history via iscn id', async (t) => {
  const res = await axiosist.get(`/api/likernft/history?iscn_id=${ISCN_ID}`)
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.list[0].txHash, '5D5FA1727B20D84675FB6F98240712034E1ABDD04B400F9609093F092E2DAAF9');
});

test('likernft: query history via class id', async (t) => {
  const res = await axiosist.get(`/api/likernft/history?class_id=${CLASS_ID}`)
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.list[0].txHash, '5D5FA1727B20D84675FB6F98240712034E1ABDD04B400F9609093F092E2DAAF9');
});
