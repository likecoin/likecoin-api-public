import { Request, Response, NextFunction } from 'express';

import { PLUS_READING_SERVICE_TOKEN } from '../../config/config';

import { constantTimeEqual } from '../util/misc';
import { ValidationError } from '../util/ValidationError';

const BEARER_PREFIX = 'Bearer ';

// Guards the internal Plus reading-usage ingest endpoint. The 3ook.com backend
// forwards already-paced (anti-fraud) usage deltas server-to-server, so a shared
// secret is sufficient — no user JWT is involved.
export function plusReadingServiceAuth(req: Request, res: Response, next: NextFunction) {
  if (!PLUS_READING_SERVICE_TOKEN) {
    next(new ValidationError('PLUS_READING_SERVICE_TOKEN_NOT_CONFIGURED', 500));
    return;
  }
  const header = req.get('Authorization');
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new ValidationError('PLUS_READING_SERVICE_TOKEN_MALFORMED', 401));
    return;
  }
  const provided = header.slice(BEARER_PREFIX.length);
  if (!constantTimeEqual(provided, PLUS_READING_SERVICE_TOKEN)) {
    next(new ValidationError('UNAUTHORIZED', 401));
    return;
  }
  next();
}

export default plusReadingServiceAuth;
