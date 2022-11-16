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

const widgetURLPaths = ['', '/', '/iscn', '/iscn/', '/nft', '/nft/', '/in/nft', '/in/nft/'];

const router = Router();

async function processLikerId(req, res, { parsedURL }) {
  // matches
  // (1) /(user_id)
  // (2) /in/like/(user_id)
  // (3) /user/(user_id)
  const userUrlRegexp = /^\/(?:in\/like\/|user\/)?([-_a-z0-9]+)$/;

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
  const maxWidth = Number.parseInt(req.query.maxwidth || 360, 10);
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
  // iscn_id could be (and should be?) URL component encoded
  // (but seems Embedly is ignoring the whole query string...)

  // URL from Embedly is missing one `/` in `iscn://`
  // (i.e. we are receiving `iscn:/blablabla`)
  // so one extra `?` in regexp
  const iscnIdRegexp = /^iscn:\/\/?([-_.:=+,a-zA-Z0-9]+)\/([-_.:=+,a-zA-Z0-9]+)(?:\/([0-9]+))?\/?$/;

  const { pathname } = parsedURL;
  let iscnId = '';
  if (widgetURLPaths.includes(pathname)) {
    // Matches
    // ?iscn_id=(iscn_id)
    // /?iscn_id=(iscn_id)
    // /iscn?iscn_id=(iscn_id)
    // /iscn/?iscn_id=(iscn_id)
    // /nft?iscn_id=(iscn_id)
    // /nft/?iscn_id=(iscn_id)
    // /in/nft?iscn_id=(iscn_id)
    // /in/nft/?iscn_id=(iscn_id)
    iscnId = parsedURL.searchParams.get('iscn_id');
  } else {
    // Matches
    // /(iscn_id)
    // /iscn/(iscn_id)
    // /nft/(iscn_id)
    // /in/nft/(iscn_id)
    const match = /^\/(?:iscn\/|nft\/|in\/nft\/)?(.*)$/.exec(decodeURIComponent(pathname));
    if (!match) {
      return null;
    }
    [, iscnId] = match;
  }
  iscnId = decodeURIComponent(iscnId);
  if (iscnId && iscnIdRegexp.exec(iscnId)) {
    // fix the double slash
    if (iscnId.match(/^iscn:\/[^/]/)) {
      iscnId = iscnId.replace('iscn:/', 'iscn://');
    }
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
  let nftClass;
  const { pathname } = parsedURL;
  if (widgetURLPaths.includes(pathname)) {
    // Matches
    // ?class_id=(class_id)
    // /?class_id=(class_id)
    // /iscn?class_id=(class_id)
    // /iscn/?class_id=(class_id)
    // /nft?class_id=(class_id)
    // /nft/?class_id=(class_id)
    // /in/nft?class_id=(class_id)
    // /in/nft/?class_id=(class_id)
    nftClass = parsedURL.searchParams.get('class_id');
  } else {
    // Matches
    // /(class_id)
    // /iscn/(class_id)
    // /nft/(class_id)
    // /in/nft/(class_id)
    const nftUrlRegexp = /^\/(?:iscn\/|nft\/|in\/nft\/)?(likenft1[ac-hj-np-z02-9]+)$/;
    const match = nftUrlRegexp.exec(parsedURL.pathname);
    if (!match) {
      return null;
    }
    [, nftClass] = match;
  }
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

function parseURL(url) {
  // need to support URL without protocol
  try {
    return new URL(url);
  } catch (_) {
    try {
      return new URL(`https://${url}`);
    } catch (__) {
      return null;
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { url, format = 'json' } = req.query;
    if (!url) {
      throw new ValidationError('No url query in oEmbed request');
    }
    const parsedURL = parseURL(url);
    if (parsedURL === null) {
      throw new ValidationError(`Invalid url query (${url}) in oEmbed request`);
    }
    const match = domainRegexp.exec(parsedURL.host);
    if (!match) {
      throw new ValidationError(`Invalid domain (${url}) in oEmbed request`);
    }
    const subdomain = match[1];
    if (subdomain && !allowedSubdomains.includes(subdomain)) {
      throw new ValidationError(`Invalid subdomain (${url}) in oEmbed request`);
    }

    if (!['json', 'xml'].includes(format)) {
      throw new ValidationError(`Invalid format ${format} in oEmbed request`);
    }

    const isTestingServer = (subdomain && subdomain.includes('rinkeby'));
    const hostname = isTestingServer ? 'rinkeby.like.co' : 'like.co';
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
