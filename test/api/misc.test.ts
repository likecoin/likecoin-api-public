// eslint-disable-next-line import/no-unresolved
import test from 'ava';
import axiosist from './axiosist';

test('misc: get LikeCoin price (default)', async (t) => {
  const res = await axiosist.get('/api/misc/price')
    .catch((err) => (err as any).response);

  t.is(res.status, 200);
  t.true(res.data.price >= 0);
});
