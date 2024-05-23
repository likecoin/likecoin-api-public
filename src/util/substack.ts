import axios from 'axios';

export async function subscribeEmailToLikerLandSubstack(email: string) {
  await axios.post('https://substackapi.com/api/subscribe', {
    email,
    domain: 'likerland.substack.com',
  });
}

export async function subscribeEmailToLikecoinSubstack(email: string) {
  await axios.post('https://substackapi.com/api/subscribe', {
    email,
    domain: 'likecoin.substack.com',
  });
}
