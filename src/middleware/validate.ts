import type { RequestHandler } from 'express';
import type { ZodIssue, ZodSchema } from 'zod';
import { ValidationError } from '../util/ValidationError';

type Target = 'body' | 'query' | 'params';

function formatIssues(issues: ZodIssue[]) {
  return issues.map((i) => ({
    path: i.path,
    code: i.code,
    message: i.message,
  }));
}

function makeValidator(target: Target) {
  return <T>(schema: ZodSchema<T>): RequestHandler => (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(new ValidationError('INVALID_INPUT', 400, {
        target,
        issues: formatIssues(result.error.issues),
      }));
      return;
    }
    (req as any)[target] = result.data;
    next();
  };
}

export const validateBody = makeValidator('body');
export const validateQuery = makeValidator('query');
export const validateParams = makeValidator('params');
