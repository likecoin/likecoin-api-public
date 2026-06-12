import {
  describe, it, expect, vi,
} from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../../src/middleware/validate';
import { ValidationError } from '../../src/util/ValidationError';

describe('validateBody', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('replaces req.body with the parsed data and calls next with no error', () => {
    const req: any = { body: { name: 'ada', age: 36 } };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'ada', age: 36 });
  });

  it('forwards a 400 ValidationError with target and issues on mismatch', () => {
    const req: any = { body: { name: 'ada', age: 'old' } };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(400);
    expect(err.payload.target).toBe('body');
    expect(err.payload.issues).toHaveLength(1);
    expect(err.payload.issues[0].path).toEqual(['age']);
  });
});

describe('validateQuery', () => {
  // Coerce so query strings (always strings off the wire) reach handlers typed.
  const schema = z.object({ limit: z.coerce.number() });

  it('shadows the getter-only req.query without throwing (Express 5 contract)', () => {
    // Express 5 exposes req.query as a getter-only property; a plain assignment
    // throws, so the middleware must redefine it. Reproduce that shape here.
    const req: any = { params: {} };
    Object.defineProperty(req, 'query', {
      get: () => ({ limit: '10' }),
      configurable: true,
    });
    const next = vi.fn();
    expect(() => validateQuery(schema)(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ limit: 10 });
  });
});

describe('validateParams', () => {
  const schema = z.object({ id: z.string() });

  it('forwards a ValidationError tagged with the params target on mismatch', () => {
    const req: any = { params: {} };
    const next = vi.fn();
    validateParams(schema)(req, {} as any, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.payload.target).toBe('params');
  });
});
