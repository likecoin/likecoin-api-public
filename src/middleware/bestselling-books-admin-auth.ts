import { Request, Response, NextFunction } from 'express';

import { BESTSELLING_BOOKS_ADMIN_TOKEN } from '../../config/config';

import { constantTimeEqual } from '../util/misc';
import { ValidationError } from '../util/ValidationError';

const BEARER_PREFIX = 'Bearer ';

export function bestsellingBooksAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!BESTSELLING_BOOKS_ADMIN_TOKEN) {
    next(new ValidationError('BESTSELLING_BOOKS_ADMIN_TOKEN_NOT_CONFIGURED', 500));
    return;
  }
  const header = req.get('Authorization');
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new ValidationError('BESTSELLING_BOOKS_ADMIN_TOKEN_MALFORMED', 401));
    return;
  }
  const provided = header.slice(BEARER_PREFIX.length);
  if (!constantTimeEqual(provided, BESTSELLING_BOOKS_ADMIN_TOKEN)) {
    next(new ValidationError('UNAUTHORIZED', 401));
    return;
  }
  next();
}

export default bestsellingBooksAdminAuth;
