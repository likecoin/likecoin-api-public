import test from 'ava';
import axiosist from './axiosist';

const ISCN_ID = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU/1';
const ISCN_ID_PREFIX = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU';
const CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';

test('likernft: get mint info via iscn id', async (t) => {
  const res = await axiosist.get(`/api/likernft/mint?iscn_id=${ISCN_ID}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.iscnId, ISCN_ID_PREFIX);
  t.is(res.data.classId, CLASS_ID);
});

test('likernft: get mint info via class id', async (t) => {
  const res = await axiosist.get(`/api/likernft/mint?class_id=${CLASS_ID}`)
    .catch(err => err.response);

  t.is(res.status, 200);
  t.is(res.data.iscnId, ISCN_ID_PREFIX);
  t.is(res.data.classId, CLASS_ID);
});

test('likernft: post mint fail due to exist', async (t) => {
  const res = await axiosist.post(`/api/likernft/mint?iscn_id=${ISCN_ID}&class_id=${CLASS_ID}`)
    .catch(err => err.response);

  t.is(res.status, 409);
});
