import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import { sendValidatedJSON } from '../../src/util/ValidationHelper';
import { TEST_MODE } from '../../src/constant';

function mockRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  return res as Response & { json: ReturnType<typeof vi.fn> };
}

const schema = z.object({ id: z.string(), count: z.number() });

describe('sendValidatedJSON', () => {
  it('keeps response-schema enforcement active under the test runner (TEST_MODE on)', () => {
    // Guard the safety mechanism itself: if TEST_MODE ever reads false here, the
    // safeParse below is skipped and every response-schema mismatch ships silently.
    expect(TEST_MODE).toBeTruthy();
  });

  it('sends data that matches the schema', () => {
    const res = mockRes();
    const data = { id: 'abc', count: 3 };
    sendValidatedJSON(res, schema, data);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('throws RESPONSE_SCHEMA_MISMATCH and does not send when data violates the schema', () => {
    const res = mockRes();
    expect(() => sendValidatedJSON(res, schema, { id: 'abc', count: 'nope' } as any))
      .toThrow(/RESPONSE_SCHEMA_MISMATCH/);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('sendValidatedJSON in production (TEST_MODE off)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('passes mismatched data through without throwing (no runtime parse in prod)', async () => {
    // Re-import with a production-like env so the re-evaluated TEST_MODE is false.
    // This locks the deliberate passthrough: legacy datastore values must never
    // 500 a live response, and this is NOT a confidentiality boundary.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', '');
    const { sendValidatedJSON: prodSend } = await import('../../src/util/ValidationHelper');
    const res = mockRes();
    const bad = { id: 'abc', count: 'nope' };
    expect(() => prodSend(res, schema, bad as any)).not.toThrow();
    expect(res.json).toHaveBeenCalledWith(bad);
  });
});
