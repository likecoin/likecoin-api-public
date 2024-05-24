import axios from 'axios';

async function subscribeEmailToSubstack(payload: { email: string; domain: string }) {
  await axios.post('https://substackapi.com/api/subscribe', payload);
}

export async function subscribeEmailToLikerLandSubstack(email: string) {
  await subscribeEmailToSubstack({
    email,
    domain: 'likerland.substack.com',
  });
}

export async function subscribeEmailToLikecoinSubstack(email: string) {
  await subscribeEmailToSubstack({
    email,
    domain: 'likecoin.substack.com',
  });
}
