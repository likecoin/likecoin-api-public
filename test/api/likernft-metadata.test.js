// import test from 'ava';
// import axiosist from './axiosist';

// const ISCN_ID_PREFIX = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU';
// const CLASS_ID = 'likenft1rjmx2tr3fxj5gylnems3yz2y9hmz9k6vdjfewzav86cqu3gp3vaq83zw56';
// const NFT_ID_1 = 'liker-00027b31-b5a7-429b-84c8-b25a2e45c173';
// const NFT_ID_2 = 'liker-0030e3e2-f5f9-40c7-8649-833e61a9bc35';

// test('likernft: get metadata info via class_id', async (t) => {
//   const res = await axiosist.get(`/api/likernft/metadata?class_id=${CLASS_ID}`)
//     .catch(err => err.response);

//   t.is(res.status, 200);
//   t.is(res.data.iscnId, ISCN_ID_PREFIX);
// });

// test('likernft: get metadata info via class_id and nft_id', async (t) => {
//   const res1 = await axiosist
//     .get(`/api/likernft/metadata?class_id=${CLASS_ID}&nft_id${NFT_ID_1}`)
//     .catch(err => err.response);
//   t.is(res1.status, 200);
//   t.is(res1.data.iscnId, ISCN_ID_PREFIX);

//   const res2 = await axiosist
//     .get(`/api/likernft/metadata?class_id=${CLASS_ID}&nft_id${NFT_ID_2}`)
//     .catch(err => err.response);
//   t.is(res2.status, 200);
//   t.is(res2.data.iscnId, ISCN_ID_PREFIX);
// });

// test('likernft: get nft image', async (t) => {
//   const res = await axiosist.get(`/api/likernft/metadata/image/class_${CLASS_ID}.png`)
//     .catch(err => err.response);
//   t.is(res.status, 200);
//   t.is(res.headers['content-type'], 'image/png');
// });
