import test from 'ava';
import FormData from 'form-data';
import fs from 'fs';
import axiosist from './axiosist';
import {
  testingUser1,
} from './data';

const { jwtSign } = require('./jwt');

test('estimation: new', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const res = await axiosist.post('/api/iscn/new?claim=1&estimate=1', {
    recordNotes: 'A Message posted on depub.SPACE',
    contentFingerprints: [
      'https://depub.blog',
    ],
    stakeholders: [
      {
        entity: {
          '@id': 'like156gedr03g3ggwktzhygfusax4df46k8dh6w0me',
          name: 'kuan',
        },
        rewardProportion: 0.975,
        contributionType: 'http://schema.org/author',
      },
      {
        entity: {
          '@id': 'https://depub.SPACE',
          name: 'depub.SPACE',
        },
        rewardProportion: 0,
        contributionType: 'http://schema.org/publisher',
      },
    ],
    type: 'CreativeWork',
    name: '0000',
    description: 'for api new iscn test #superlike',
    datePublished: '',
    url: '',
    usageInfo: '',
    keywords: [],
  },
  {
    headers: {
      Cookie: `likecoin_auth=${token};`,
    },
  })
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.LIKE, 0.01231472);
});

test('estimation: upload', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const file = fs.createReadStream('./test/api/test.png');
  const formData = new FormData();
  formData.append('metadata', JSON.stringify({
    recordNotes: 'Add IPFS fingerprint',
    contentFingerprints: [
      'hash://sha256/9564b85669d5e96ac969dd0161b8475bbced9e5999c6ec598da718a3045d6f2e',
      'ipfs://QmNrgEMcUygbKzZeZgYFosdd27VE9KnWbyUD73bKZJ3bGi',
    ],
    stakeholders: [
      {
        entity: {
          '@id': 'did:cosmos:5sy29r37gfxvxz21rh4r0ktpuc46pzjrmz29g45',
          name: 'Chung Wu',
        },
        rewardProportion: 95,
        contributionType: 'http://schema.org/author',
      },
      {
        rewardProportion: 5,
        contributionType: 'http://schema.org/citation',
        footprint: 'https://en.wikipedia.org/wiki/Fibonacci_number',
        description: 'The blog post referred the matrix form of computing Fibonacci numbers.',
      },
    ],
    type: 'Article',
    name: '12345678',
    description: 'An article on computing recursive function with matrix multiplication.',
    datePublished: '2019-04-19',
    url: 'https://nnkken.github.io/post/recursive-relation/',
    usageInfo: 'https://creativecommons.org/licenses/by/4.0',
    keywords: ['matrix', 'recursion'],
  }));
  formData.append('index.html', file, 'test.png');
  formData.append('asset/image.png', file, 'test.png');
  const res = await axiosist.post('/api/iscn/upload?claim=1&deduplicate=1&estimate=1', formData,
    {
      headers: {
        ...formData.getHeaders(),
        Cookie: `likecoin_auth=${token};`,
      },
    })
    .catch(err => err.response);
  t.is(res.status, 200);
  t.is(res.data.LIKE, 3.01311472);
});
