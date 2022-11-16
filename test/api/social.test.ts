import test from 'ava';
import {
  testingUser1,
} from './data';
import axiosist from './axiosist';

test.serial('SOCIAL: Get public info. Case: Do not show empty platform object', async (t) => {
  const user = testingUser1;
  const res = await axiosist.get(`/api/social/list/${user}`)
    .catch(err => err.response);
  t.is(res.status, 200);
  t.true('link0' in res.data);
  t.true('matters' in res.data);
  t.false('medium' in res.data); // Data are not in whitelist
});
