import test from 'ava';
import axiosist from './axiosist';

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
