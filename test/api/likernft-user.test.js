import test from 'ava';
import axiosist from './axiosist';

const CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';
const WALLET = 'like1jnns8ttx8nhxleatsgwnrcandgw7a8sx24nc78';

test('likernft: get user owned nft', async (t) => {
  const res = await axiosist.get(`/api/likernft/user/${WALLET}/own`)
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.list[0], CLASS_ID);
});

test('likernft: get user selling nft', async (t) => {
  const res = await axiosist.get(`/api/likernft/user/${WALLET}/sell`)
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.list[0], CLASS_ID);
});
