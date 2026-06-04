import { Request, Response, NextFunction } from 'express';

import { PLUS_SETTLE_ADMIN_TOKEN } from '../../config/config';

import { constantTimeEqual } from '../util/misc';
import { ValidationError } from '../util/ValidationError';

const BEARER_PREFIX = 'Bearer ';

// Guards the admin-triggered Plus reading revenue-share settle endpoint. This moves
// money (Stripe Connect transfers), so it uses a dedicated secret separate from the
// reading-usage ingest token — triggered by Cloud Scheduler or an operator.
export function plusSettleAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!PLUS_SETTLE_ADMIN_TOKEN) {
    next(new ValidationError('PLUS_SETTLE_ADMIN_TOKEN_NOT_CONFIGURED', 500));
    return;
  }
  const header = req.get('Authorization');
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new ValidationError('PLUS_SETTLE_ADMIN_TOKEN_MALFORMED', 401));
    return;
  }
  const provided = header.slice(BEARER_PREFIX.length);
  if (!constantTimeEqual(provided, PLUS_SETTLE_ADMIN_TOKEN)) {
    next(new ValidationError('UNAUTHORIZED', 401));
    return;
  }
  next();
}

export default plusSettleAdminAuth;
