import test from 'ava';
import {
  testingUser2,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

const trialEventsForTest = [
  {
    id: 'nonexistent',
    status: 404,
  },
  {
    id: 'past',
    status: 410,
  },
  {
    id: 'full',
    status: 410,
  },
  {
    id: 'future',
    status: 404,
  },
  {
    id: 'active',
    status: 200,
  },
];
for (let i = 0; i < trialEventsForTest.length; i += 1) {
  const { id, status } = trialEventsForTest[i];
  test.serial(`CIVIC: Get ${id} Civic Liker trial events`, async (t) => {
    const res = await axiosist.get(`/api/civic/trial/events/${id}`).catch(err => err.response);
    t.is(res.status, status);
  });
}

const trialEventsForJoiningTest = [...trialEventsForTest, {
  id: 'active',
  status: 409,
}];
for (let i = 0; i < trialEventsForJoiningTest.length; i += 1) {
  const { id, status } = trialEventsForJoiningTest[i];
  let name = `USER: Join ${id} Civic Liker trial event`;
  if (i === trialEventsForJoiningTest.length - 1) name += ' again';

  test.serial(name, async (t) => {
    const token = jwtSign({ user: testingUser2 });
    const res = await axiosist
      .post(`/api/civic/trial/events/${id}/join`, {}, {
        headers: {
          Cookie: `likecoin_auth=${token}`,
        },
      })
      .catch(err => err.response);
    t.is(res.status, status);

    if (res.status === 200) {
      t.is(Number.isInteger(res.data.start), true);
      t.is(Number.isInteger(res.data.end), true);
    }
  });
}
