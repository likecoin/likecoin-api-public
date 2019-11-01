import test from 'ava';
import axiosist from './axiosist';

test('misc: get LikeCoin price (default)', async (t) => {
  const res = await axiosist.get('/api/misc/price')
    .catch(err => err.response);

  t.is(res.status, 200);
  t.true(res.data.price >= 0);
});

test('misc: get LikeCoin price (TWD)', async (t) => {
  const res = await axiosist.get('/api/misc/price?convert=twd')
    .catch(err => err.response);

  t.is(res.status, 200);
  t.true(res.data.price >= 0);
});
