import axios from 'axios';
import { QUERY_STRING_TO_REMOVE } from '../../../constant';
import {
  LIKECO_INTERNAL_API_ENDPOINT,
  LIKECO_INTERNAL_API_KEY,
} from '../../../../config/config';

const querystring = require('querystring');
const URL = require('url-parse');

export function addUrlToMetadataCrawler(url) {
  return axios.post(
    `${LIKECO_INTERNAL_API_ENDPOINT}/like-button-info`,
    { list: [querystring.escape(url)] },
    {
      headers: {
        Authorization: LIKECO_INTERNAL_API_KEY,
      },
    },
  );
}

export function removeQueryStringFromBookmarkUrl(inputUrl) {
  try {
    const url = new URL(inputUrl, true);
    QUERY_STRING_TO_REMOVE.forEach((qs) => {
      delete url.query[qs];
    });
    url.set('query', url.query);

    return url.toString();
  } catch (err) {
    return '';
  }
}

export default addUrlToMetadataCrawler;
