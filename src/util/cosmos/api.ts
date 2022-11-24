import HttpAgent, { HttpsAgent } from 'agentkeepalive';
import axios from 'axios';

export function createAPIEndpoint(endpoint) {
  return axios.create({
    baseURL: endpoint,
    httpAgent: new HttpAgent(),
    httpsAgent: new HttpsAgent(),
  });
}

export default createAPIEndpoint;
