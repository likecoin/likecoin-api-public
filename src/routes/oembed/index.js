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

const subdomain = ['www.', 'rinkeby.', 'button.', 'button.rinkeby.', 'widget.'];
// matches like.co/(id), button.like.co/(id) and button.like.co/in/like/(id)
const queryUrlRegexp = new RegExp('^(?:https?:\\/\\/)?([a-z0-9.]+)?like\\.co(?:\\/in\\/like)?\\/([-_a-z0-9]+)');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) {
      throw new ValidationError('No url query in oEmbed request');
    }
    const match = queryUrlRegexp.exec(url);
    if (!match) {
      throw new ValidationError(`Invalid url query (${url}) in oEmbed request`);
    }
    if (match[1] && !subdomain.includes(match[1])) {
      throw new ValidationError(`Invalid subdomain (${url}) in oEmbed request`);
    }
    const hostname = (match[1] && match[1].includes('rinkeby')) ? 'rinkeby.like.co' : 'like.co';
    const username = match[2];
    const format = req.query.format || 'json';
    if (!['json', 'xml'].includes(format)) {
      throw new ValidationError(`Invalid format ${format} in oEmbed request`);
    }

    const maxWidth = Number.parseInt(req.query.maxwidth || 485, 10);
    const maxHeight = Number.parseInt(req.query.maxheight || 212, 10);
    const thumbnailLength = Math.min(100, maxWidth, maxHeight);

    const doc = await dbRef.doc(username).get();
    if (!doc.exists) {
      res.sendStatus(404);
      return;
    }
    const payload = doc.data();
    if (!payload.avatar) payload.avatar = AVATAR_DEFAULT_PATH;

    const urlHostname = `${match[1] || ''}like.co`;
    const replyUrl = `https://${urlHostname}/${username}`;
    const src = `https://${urlHostname}/in/embed/${username}/button`;

    const displayName = payload.displayName || username;
    const oEmbedResponse = {
      type: 'rich',
      version: '1.0',
      title: res.__('LikeButton.head.title', { name: displayName }),
      url: replyUrl,
      thumbnail_url: payload.avatar,
      thumbnail_width: thumbnailLength,
      thumbnail_height: thumbnailLength,
      html: `<iframe width="${maxWidth}" height="${maxHeight}"
        src="${src}"
        frameborder="0">
        </iframe>`,
      provider_name: 'LikeCoin',
      provider_url: `https://${hostname}`,
      width: maxWidth,
      height: maxHeight,
    };
    switch (format) {
      case 'json':
        res.json(oEmbedResponse);
        break;
      case 'xml': {
        res.set('Content-Type', 'text/xml');
        const xmlArray = Object.keys(oEmbedResponse).map(key => ({ [key]: oEmbedResponse[key] }));
        res.send(xml({ oembed: xmlArray }, { declaration: { encoding: 'utf-8', standalone: 'yes' } }));
        break;
      }
      default:
    }
  } catch (err) {
    console.error(err);
    next(err);
  }
});

export default router;
