import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import { sendValidatedJSON } from '../../src/util/ValidationHelper';

function mockRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  return res as Response & { json: ReturnType<typeof vi.fn> };
}

const schema = z.object({ id: z.string(), count: z.number() });

describe('sendValidatedJSON', () => {
  it('sends data that matches the schema', () => {
    const res = mockRes();
    const data = { id: 'abc', count: 3 };
    sendValidatedJSON(res, schema, data);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('strips undeclared keys from the response', () => {
    const res = mockRes();
    sendValidatedJSON(res, schema, { id: 'abc', count: 3, secret: 'leak' } as any);
    expect(res.json).toHaveBeenCalledWith({ id: 'abc', count: 3 });
  });

  it('keeps undeclared keys on .passthrough() schemas', () => {
    const res = mockRes();
    const passthrough = schema.passthrough();
    const data = { id: 'abc', count: 3, extra: 'kept' };
    sendValidatedJSON(res, passthrough, data);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('throws RESPONSE_SCHEMA_MISMATCH and does not send when data violates the schema', () => {
    const res = mockRes();
    expect(() => sendValidatedJSON(res, schema, { id: 'abc', count: 'nope' } as any))
      .toThrow(/RESPONSE_SCHEMA_MISMATCH/);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('sendValidatedJSON in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enforces the schema in prod too (parses unconditionally, throws on mismatch)', async () => {
    // Re-import with a production-like env to confirm enforcement no longer hinges
    // on TEST_MODE: a response-schema mismatch throws RESPONSE_SCHEMA_MISMATCH in
    // prod, surfacing drift instead of shipping malformed data silently.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', '');
    const { sendValidatedJSON: prodSend } = await import('../../src/util/ValidationHelper');
    const res = mockRes();
    expect(() => prodSend(res, schema, { id: 'abc', count: 'nope' } as any))
      .toThrow(/RESPONSE_SCHEMA_MISMATCH/);
    expect(res.json).not.toHaveBeenCalled();
  });
});
