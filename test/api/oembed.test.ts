import test from 'ava';
import {
  testingUser1,
  testingDisplayName1,
  testingUser2,
} from './data';
import axiosist from './axiosist';

test('OEMBED: success cases', async (t) => {
  let res;

  /* User button test */
  res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  res = await axiosist.get(`/api/oembed?url=http://rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  res = await axiosist.get(`/api/oembed?url=rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser2}&maxwidth=50`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingUser2), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://rinkeby.like.co/${testingUser2}`);
  t.is(res.data.thumbnail_width, 50);
  t.is(res.data.thumbnail_height, 50);

  res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://button.rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/in/like/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://button.rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/user/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.is(res.data.type, 'rich');
  t.is(res.data.title.includes(testingDisplayName1), true);
  t.is(res.data.version, '1.0');
  t.is(res.data.author_url, `https://button.rinkeby.like.co/${testingUser1}`);
  t.is(res.data.thumbnail_width, 100);
  t.is(res.data.thumbnail_height, 100);

  /* ISCN ID button test */
  const iscnIdPrefix = 'iscn://likecoin-chain/fKzVj-8lF59UATj1-egqV1YLJcBz39as_t0dedHHFIo';
  for (const rawIscnId of [iscnIdPrefix, `${iscnIdPrefix}/3`]) {
    // Embedly removed one '/'
    for (const iscnId of [rawIscnId, rawIscnId.replace('iscn://', 'iscn:/')]) {
      for (const param of [iscnId, encodeURIComponent(iscnId)]) {
        const queryURLs = [
          `https://button.rinkeby.like.co?iscn_id=${param}`,
          `https://button.rinkeby.like.co/?iscn_id=${param}`,
          `https://button.rinkeby.like.co/${param}`,
          `https://button.rinkeby.like.co/iscn?iscn_id=${param}`,
          `https://button.rinkeby.like.co/iscn/?iscn_id=${param}`,
          `https://button.rinkeby.like.co/iscn/${param}`,
          `https://button.rinkeby.like.co/nft?iscn_id=${param}`,
          `https://button.rinkeby.like.co/nft/?iscn_id=${param}`,
          `https://button.rinkeby.like.co/nft/${param}`,
          `https://button.rinkeby.like.co/in/nft?iscn_id=${param}`,
          `https://button.rinkeby.like.co/in/nft/?iscn_id=${param}`,
          `https://button.rinkeby.like.co/in/nft/${param}`,
        ];
        for (const oEmbedURL of queryURLs) {
          res = await axiosist.get(`/api/oembed?url=${encodeURIComponent(oEmbedURL)}`)
            .catch(err => (err as any).response);
          t.is(res.status, 200);
          t.is(res.data.type, 'rich');
          t.is(res.data.version, '1.0');
          t.is(decodeURIComponent(res.data.html).includes(rawIscnId), true);
        }
      }
    }
  }
  /* extra tests extracted from Embedly requests */
  const extraTestURLs = [
    '/api/oembed?url=https%3A%2F%2Fbutton.rinkeby.like.co%2Fiscn%3A%2Flikecoin-chain%2FfKzVj-8lF59UATj1-egqV1YLJcBz39as_t0dedHHFIo%2F1&format=json',
    '/api/oembed?url=https%3A%2F%2Fbutton.rinkeby.like.co%2Fiscn%2Fiscn%3A%2Flikecoin-chain%2FIKI9PueuJiOsYvhN6z9jPJIm3UGMh17BQ3tEwEzslQo&format=json',
    '/api/oembed?url=https%3A%2F%2Fbutton.rinkeby.like.co%2Fiscn%3A%2Flikecoin-chain%2FIKI9PueuJiOsYvhN6z9jPJIm3UGMh17BQ3tEwEzslQo&format=json',
    '/api/oembed?url=https%3A%2F%2Fbutton.rinkeby.like.co%2Fiscn%2Fiscn%3A%2Flikecoin-chain%2FfKzVj-8lF59UATj1-egqV1YLJcBz39as_t0dedHHFIo%2F1&format=json',
  ];
  for (const url of extraTestURLs) {
    res = await axiosist.get(url)
      .catch(err => (err as any).response);
    t.is(res.status, 200, `url = ${url}`);
    t.is(res.data.type, 'rich');
    t.is(res.data.version, '1.0');
  }

  /* NFT class button test */
  const nftClass = 'likenft10f06wfaql5fxf3g4sy8v57p98lzp7ad92cu34f9aeyhyeklchznsav5npg';
  const queryURLs = [
    `https://button.rinkeby.like.co?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/${nftClass}`,
    `https://button.rinkeby.like.co/iscn?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/iscn/?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/iscn/${nftClass}`,
    `https://button.rinkeby.like.co/nft?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/nft/?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/nft/${nftClass}`,
    `https://button.rinkeby.like.co/in/nft?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/in/nft/?class_id=${nftClass}`,
    `https://button.rinkeby.like.co/in/nft/${nftClass}`,
  ];
  for (const oEmbedURL of queryURLs) {
    res = await axiosist.get(`/api/oembed?url=${oEmbedURL}`)
      .catch(err => (err as any).response);
    t.is(res.status, 200, `url = ${oEmbedURL}`);
    t.is(res.data.type, 'rich');
    t.is(res.data.version, '1.0');
    t.is(res.data.thumbnail_width, 100);
    t.is(res.data.thumbnail_height, 100);
    t.is(res.data.html.includes(nftClass), true);
  }

  /* xml format test */
  res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}&format=xml`)
    .catch(err => (err as any).response);
  t.is(res.status, 200);
  t.true(res.data.includes('<?xml version="1.0" encoding="utf-8" standalone="yes"?><oembed>'));
  t.true(res.data.includes('<type>rich</type>'));
  t.true(res.data.includes('<version>1.0</version>'));
  t.true(res.data.includes('<title>Like testing&apos;s work</title>'));
  t.true(res.data.includes('<author_name>testing</author_name>'));
  t.true(res.data.includes('<author_url>https://rinkeby.like.co/testing</author_url>'));
});

test('OEMBED: failure cases', async (t) => {
  let res;

  res = await axiosist.get(`/api/oembed?url=www.rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 400);

  res = await axiosist.get(`/api/oembed?url=https://www.rinkeby.like.co/${testingUser1}`)
    .catch(err => (err as any).response);
  t.is(res.status, 400);

  res = await axiosist.get('/api/oembed?url=https://rinkeby.like.co/nosuchuser')
    .catch(err => (err as any).response);
  t.is(res.status, 404);

  res = await axiosist.get('/api/oembed')
    .catch(err => (err as any).response);
  t.is(res.status, 400);
  t.is(res.data, 'No url query in oEmbed request');

  res = await axiosist.get('/api/oembed?url=www.invalidurl.co/testing')
    .catch(err => (err as any).response);
  t.is(res.status, 400);
  t.is(res.data, 'Invalid domain (www.invalidurl.co/testing) in oEmbed request');

  res = await axiosist.get('/api/oembed?url=www.invalidurl.like.co/testing')
    .catch(err => (err as any).response);
  t.is(res.status, 400);
  t.is(res.data, 'Invalid subdomain (www.invalidurl.like.co/testing) in oEmbed request');

  res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}&format=nosuchformat`)
    .catch(err => (err as any).response);
  t.is(res.status, 400);
  t.is(res.data, 'Invalid format nosuchformat in oEmbed request');
});
