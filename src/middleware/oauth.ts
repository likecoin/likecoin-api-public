import LRU from 'lru-cache';
import {
  oAuthClientCollection as oAuthClientDbRef,
} from '../util/firebase';

import { setNoCacheHeader } from './noCache';
import { ValidationError } from '../util/ValidationError';
import { filterOAuthClientInfo } from '../util/ValidationHelper';
import type { OAuthClientInfo } from '../types/firestore';

const providerOAuthClientInfo = new LRU({ max: 128, maxAge: 10 * 60 * 1000 }); // 10 min

export const getOAuthClientInfo = ({ checkSecret = true } = {}) => async (req, res, next) => {
  try {
    setNoCacheHeader(res);
    const clientId = req.body.client_id || req.query.client_id;
    const clientSecret = req.body.client_secret || req.query.client_secret;
    if (!clientId || (checkSecret && !clientSecret)) throw new ValidationError('MISSING_CLIENT_INFO');
    let clientInfo: OAuthClientInfo | undefined = providerOAuthClientInfo.get(
      clientId,
    ) as OAuthClientInfo | undefined;
    const isUsingCache = !!clientInfo;
    if (!isUsingCache) {
      const spClient = await oAuthClientDbRef.doc(clientId).get();
      if (!spClient.exists) throw new ValidationError('INVALID_CLIENT_CRED');
      clientInfo = spClient.data();
    }
    if (!clientInfo) throw new ValidationError('INVALID_CLIENT_CRED');
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
