import test from 'ava';
import {
  testingUser1,
} from './data';
import axiosist from './axiosist';

const { jwtSign } = require('./jwt');

test.serial('USER: Queue for Civic Liker', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  let res = await axiosist.put(`/api/civic/queue/user/${user}`, { }, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  res = await axiosist.get(`/api/users/id/${user}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.civicLikerStatus, 'waiting');
});

test.serial('USER: Dequeue for Civic Liker', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  let res = await axiosist.delete(`/api/civic/queue/user/${user}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  }).catch(err => err.response);

  t.is(res.status, 200);
  res = await axiosist.get(`/api/users/id/${user}`, {
    headers: {
      Cookie: `likecoin_auth=${token}`,
    },
  });
  t.is(res.status, 200);
  t.is(res.data.civicLikerStatus, 'intercom');
});

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
