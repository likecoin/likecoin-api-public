import { describe, it, expect } from 'vitest';
import {
  testingUser1,
  testingDisplayName1,
  testingUser2,
} from './data';
import axiosist from './axiosist';

describe('OEMBED: user button', () => {
  it('should handle various URL formats', async () => {
    let res;

    /* User button test */
    res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);

    res = await axiosist.get(`/api/oembed?url=http://rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);

    res = await axiosist.get(`/api/oembed?url=rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);

    res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser2}&maxwidth=50`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingUser2)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://rinkeby.like.co/${testingUser2}`);
    expect(res.data.thumbnail_width).toBe(50);
    expect(res.data.thumbnail_height).toBe(50);

    res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://button.rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);

    res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/in/like/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://button.rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);

    res = await axiosist.get(`/api/oembed?url=https://button.rinkeby.like.co/user/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('rich');
    expect(res.data.title.includes(testingDisplayName1)).toBe(true);
    expect(res.data.version).toBe('1.0');
    expect(res.data.author_url).toBe(`https://button.rinkeby.like.co/${testingUser1}`);
    expect(res.data.thumbnail_width).toBe(100);
    expect(res.data.thumbnail_height).toBe(100);
  });
});

describe('OEMBED: iscn id button', () => {
  it('should handle ISCN ID button variations', async () => {
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
            const res = await axiosist.get(`/api/oembed?url=${encodeURIComponent(oEmbedURL)}`)
              .catch((err) => (err as any).response);
            expect(res.status).toBe(200);
            expect(res.data.type).toBe('rich');
            expect(res.data.version).toBe('1.0');
            expect(decodeURIComponent(res.data.html).includes(rawIscnId)).toBe(true);
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
      const res = await axiosist.get(url)
        .catch((err) => (err as any).response);
      expect(res.status).toBe(200);
      expect(res.data.type).toBe('rich');
      expect(res.data.version).toBe('1.0');
    }
  });
});

describe('OEMBED: nft class button', () => {
  it('should handle NFT class button variations', async () => {
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
      const res = await axiosist.get(`/api/oembed?url=${oEmbedURL}`)
        .catch((err) => (err as any).response);
      expect(res.status).toBe(200);
      expect(res.data.type).toBe('rich');
      expect(res.data.version).toBe('1.0');
      expect(res.data.thumbnail_width).toBe(100);
      expect(res.data.thumbnail_height).toBe(100);
      expect(res.data.html.includes(nftClass)).toBe(true);
    }
  });
});

describe('OEMBED: xml format test', () => {
  it('should return XML format', async () => {
    /* xml format test */
    const res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}&format=xml`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(200);
    expect(res.data.includes('<?xml version="1.0" encoding="utf-8" standalone="yes"?><oembed>')).toBe(true);
    expect(res.data.includes('<type>rich</type>')).toBe(true);
    expect(res.data.includes('<version>1.0</version>')).toBe(true);
    expect(res.data.includes('<title>Like testing&apos;s work</title>')).toBe(true);
    expect(res.data.includes('<author_name>testing</author_name>')).toBe(true);
    expect(res.data.includes('<author_url>https://rinkeby.like.co/testing</author_url>')).toBe(true);
  });
});

describe('OEMBED: failure cases', () => {
  it('should handle various error cases', async () => {
    let res;

    res = await axiosist.get(`/api/oembed?url=www.rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);

    res = await axiosist.get(`/api/oembed?url=https://www.rinkeby.like.co/${testingUser1}`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);

    res = await axiosist.get('/api/oembed?url=https://rinkeby.like.co/nosuchuser')
      .catch((err) => (err as any).response);
    expect(res.status).toBe(404);

    res = await axiosist.get('/api/oembed')
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);
    expect(res.data).toBe('No url query in oEmbed request');

    res = await axiosist.get('/api/oembed?url=www.invalidurl.co/testing')
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);
    expect(res.data).toBe('Invalid domain (www.invalidurl.co/testing) in oEmbed request');

    res = await axiosist.get('/api/oembed?url=www.invalidurl.like.co/testing')
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);
    expect(res.data).toBe('Invalid subdomain (www.invalidurl.like.co/testing) in oEmbed request');

    res = await axiosist.get(`/api/oembed?url=https://rinkeby.like.co/${testingUser1}&format=nosuchformat`)
      .catch((err) => (err as any).response);
    expect(res.status).toBe(400);
    expect(res.data).toBe('Invalid format nosuchformat in oEmbed request');
  });
});
