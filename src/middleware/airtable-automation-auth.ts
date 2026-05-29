import { Request, Response, NextFunction } from 'express';

import { AIRTABLE_AUTOMATION_TOKEN } from '../../config/config';

import { constantTimeEqual } from '../util/misc';
import { ValidationError } from '../util/ValidationError';

const BEARER_PREFIX = 'Bearer ';

export function airtableAutomationAuth(req: Request, res: Response, next: NextFunction) {
  if (!AIRTABLE_AUTOMATION_TOKEN) {
    next(new ValidationError('AIRTABLE_AUTOMATION_TOKEN_NOT_CONFIGURED', 500));
    return;
  }
  const header = req.get('Authorization');
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new ValidationError('AIRTABLE_AUTOMATION_TOKEN_MALFORMED', 401));
    return;
  }
  const provided = header.slice(BEARER_PREFIX.length);
  if (!constantTimeEqual(provided, AIRTABLE_AUTOMATION_TOKEN)) {
    next(new ValidationError('UNAUTHORIZED', 401));
    return;
  }
  next();
}

export default airtableAutomationAuth;
