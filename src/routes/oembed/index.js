/* eslint-disable no-underscore-dangle */
import { Router } from 'express';
import xml from 'xml';

import { ValidationError } from '../../util/ValidationError';
import {
  AVATAR_DEFAULT_PATH,
} from '../../constant';
import {
  userCollection as dbRef,
} from '../../util/firebase';

const allowedSubdomains = ['www.', 'rinkeby.', 'button.', 'button.rinkeby.', 'widget.'];
const domainRegexp = /^((?:[a-z0-9]+\.)+)?like\.co$/;

// matches like.co/(id), button.like.co/(id) and button.like.co/in/like/(id)
const userUrlRegexp = /^(?:\/in\/like)?\/([-_a-z0-9]+)$/;

const router = Router();

async function processLikerId(req, res, { parsedURL }) {
  const { pathname } = parsedURL;
  const pathnameMatch = userUrlRegexp.exec(pathname);
  if (!pathnameMatch) {
    return null;
  }
  const username = pathnameMatch[1];
  const doc = await dbRef.doc(username).get();
  if (!doc.exists) {
    res.sendStatus(404);
    return { error: 404 };
  }
  const payload = doc.data();
  if (!payload.avatar) payload.avatar = AVATAR_DEFAULT_PATH;

  const replyUrl = `https://${parsedURL.host}/${username}`;
  const src = `https://${parsedURL.host}/in/embed/${username}/button`;
  const maxWidth = Number.parseInt(req.query.maxwidth || 485, 10);
  const maxHeight = Number.parseInt(req.query.maxheight || 212, 10);
  const thumbnailLength = Math.min(100, maxWidth, maxHeight);
  const displayName = payload.displayName || username;
  return {
    title: res.__('LikeButton.user.title', { name: displayName }),
    author_name: displayName,
    author_url: replyUrl,
    thumbnail_url: payload.avatar,
    thumbnail_width: thumbnailLength,
    thumbnail_height: thumbnailLength,
    html: `<iframe width="${maxWidth}" height="${maxHeight}"
      src="${src}"
      frameborder="0">
      </iframe>`,
    width: maxWidth,
    height: maxHeight,
  };
}

function getRequestIscnId(parsedURL) {
  // matches
  // (1) like.co/iscn?iscn_id=(iscn_id)
  // (2) like.co/iscn/?iscn_id=(iscn_id)
  // (3) like.co/?iscn_id=(iscn_id)
  // (4) like.co?iscn_id=(iscn_id)
  // (5) like.co/iscn/(iscn_id)
  // (6) like.co/(iscn_id)

  // iscn_id could be (and should be?) URL component encoded
  const iscnIdRegexp = /^iscn:\/\/([-_.:=+,a-zA-Z0-9]+)\/([-_.:=+,a-zA-Z0-9]+)(?:\/([0-9]+))?$/;

  const { pathname } = parsedURL;
  let iscnId = '';
  if (['', '/', '/iscn', '/iscn/'].includes(pathname)) {
    // case 1-4
    iscnId = parsedURL.searchParams.get('iscn_id');
  } else {
    // case 5-6
    const match = /^\/(?:iscn\/)?(.*)$/.exec(decodeURIComponent(pathname));
    if (!match) {
      return null;
    }
    [, iscnId] = match;
  }
  iscnId = decodeURIComponent(iscnId);
  if (iscnId && iscnIdRegexp.exec(iscnId)) {
    return iscnId;
  }
  return null;
}

async function processIscnId(req, res, { parsedURL }) {
  const iscnId = getRequestIscnId(parsedURL);
  if (!iscnId) {
    return null;
  }
  const src = `https://${parsedURL.host}/in/embed/iscn/button?iscn_id=${encodeURIComponent(iscnId)}`;
  const maxWidth = Number.parseInt(req.query.maxwidth || 360, 10);
  const maxHeight = Number.parseInt(req.query.maxheight || 480, 10);
  // TODO: thumbnail?
  return {
    title: res.__('LikeButton.iscn.title', { iscnId }),
    html: `<iframe width="${maxWidth}" height="${maxHeight}"
      src="${src}"
      frameborder="0">
      </iframe>`,
    width: maxWidth,
    height: maxHeight,
  };
}

async function processNftClass(req, res, { parsedURL }) {
  // matches
  // like.co/nft/(nft_class)
  // like.co/(nft_class)

  // In theory it is possible to have a username 'likenft[a-z0-9]+'
  // In practice it is not likely and this user may choose more explicit url format if needed
  const nftUrlRegexp = /^\/(?:nft\/)?(likenft[a-z0-9]+)$/;
  const match = nftUrlRegexp.exec(parsedURL.pathname);
  if (!match) {
    return null;
  }
  const [, nftClass] = match;
  const src = `https://${parsedURL.host}/in/embed/nft/class/${nftClass}`;
  const maxWidth = Number.parseInt(req.query.maxwidth || 360, 10);
  const maxHeight = Number.parseInt(req.query.maxheight || 480, 10);
  const thumbnailUrl = `https://api.${parsedURL.host.includes('rinkeby') ? 'rinkeby.' : ''}like.co/likernft/metadata/image/class_${nftClass}.png`;
  const thumbnailLength = Math.min(100, maxWidth, maxHeight);
  return {
    title: res.__('LikeButton.nftclass.title', { nftClass }),
    thumbnail_url: thumbnailUrl,
    thumbnail_width: thumbnailLength,
    thumbnail_height: thumbnailLength,
    html: `<iframe width="${maxWidth}" height="${maxHeight}"
      src="${src}"
      frameborder="0">
      </iframe>`,
    width: maxWidth,
    height: maxHeight,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { url, format = 'json' } = req.query;
    if (!url) {
      throw new ValidationError('No url query in oEmbed request');
    }
    let parsedURL;
    try {
      parsedURL = new URL(url);
    } catch (err) {
      throw new ValidationError(`Invalid url query (${url}) in oEmbed request`);
    }
    const match = domainRegexp.exec(parsedURL.host);
    if (!match) {
      throw new ValidationError(`Invalid url query (${url}) in oEmbed request`);
    }
    const subdomain = match[1];
    if (subdomain && !allowedSubdomains.includes(subdomain)) {
      throw new ValidationError(`Invalid subdomain (${url}) in oEmbed request`);
    }

    if (!['json', 'xml'].includes(format)) {
      throw new ValidationError(`Invalid format ${format} in oEmbed request`);
    }

    const hostname = (subdomain && subdomain.includes('rinkeby')) ? 'rinkeby.like.co' : 'like.co';
    for (const handler of [processIscnId, processNftClass, processLikerId]) {
      const result = await handler(req, res, { parsedURL });
      if (result) {
        if (!result.error) {
          const oEmbedResponse = {
            type: 'rich',
            version: '1.0',
            provider_name: 'LikeCoin',
            provider_url: `https://${hostname}`,
            ...result,
          };
          switch (format) {
            case 'json':
              res.json(oEmbedResponse);
              break;
            case 'xml': {
              res.set('Content-Type', 'text/xml');
              const xmlArray = Object.keys(oEmbedResponse).map(
                key => ({ [key]: oEmbedResponse[key] }),
              );
              res.send(xml({ oembed: xmlArray }, { declaration: { encoding: 'utf-8', standalone: 'yes' } }));
              break;
            }
            default:
          }
        }
        return;
      }
    }
    throw new ValidationError(`Invalid url query (${url}) in oEmbed request`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    next(err);
  }
});

export default router;
