import {
  oAuthClientCollection as oAuthClientDbRef,
} from '../util/firebase';

import { setNoCacheHeader } from './noCache';
import { ValidationError } from '../util/ValidationError';
import { filterOAuthClientInfo } from '../util/ValidationHelper';

const LRU = require('lru-cache');

const providerOAuthClientInfo = new LRU({ max: 128, maxAge: 10 * 60 * 1000 }); // 10 min

export const getOAuthClientInfo = ({ checkSecret = true } = {}) => async (req, res, next) => {
  try {
    setNoCacheHeader(res);
    const clientId = req.body.client_id || req.query.client_id;
    const clientSecret = req.body.client_secret || req.query.client_secret;
    if (!clientId || (checkSecret && !clientSecret)) throw new ValidationError('MISSING_CLIENT_INFO');
    let clientInfo = providerOAuthClientInfo.get(clientId);
    const isUsingCache = !!clientInfo;
    if (!isUsingCache) {
      const spClient = await oAuthClientDbRef.doc(clientId).get();
      if (!spClient.exists) throw new ValidationError('INVALID_CLIENT_CRED');
      clientInfo = spClient.data();
    }
    const { secret } = clientInfo;
    if (!isUsingCache) providerOAuthClientInfo.set(clientId, filterOAuthClientInfo(clientInfo));
    if (checkSecret && clientSecret !== secret) throw new ValidationError('INVALID_CLIENT_CRED');
    req.auth = {
      ...filterOAuthClientInfo(clientInfo),
      clientId,
      secret: checkSecret ? secret : undefined,
    };
    next();
  } catch (err) {
    next(err);
  }
};

export default getOAuthClientInfo;
