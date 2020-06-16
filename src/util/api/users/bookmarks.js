import axios from 'axios';
import {
  LIKECO_INTERNAL_API_ENDPOINT,
  LIKECO_INTERNAL_API_KEY,
} from '../../../../config/config';

const querystring = require('querystring');

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

export default addUrlToMetadataCrawler;
