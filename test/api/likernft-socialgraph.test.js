import test from 'ava';
import axiosist from './axiosist';

const CREATOR = 'like1th426dy3wnu3aeqkz7efmkfalh9w7gwkvtl567';
const COLLECTOR = 'like1yney2cqn5qdrlc50yr5l53898ufdhxafqz9gxp';

test('likernft: get collector via creator address', async (t) => {
  const res = await axiosist
    .get(`/api/likernft/collector?creator=${CREATOR}`)
    .catch((err) => err.message);

  t.is(res.status, 200);
});

test('likernft: get creator via collector address', async (t) => {
  const res = await axiosist
    .get(`/api/likernft/creator?collector=${COLLECTOR}`)
    .catch((err) => err.message);

  t.is(res.status, 200);
});
