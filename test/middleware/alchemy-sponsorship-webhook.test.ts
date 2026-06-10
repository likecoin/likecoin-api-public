import {
  describe, it, expect, vi,
} from 'vitest';

// Override config to an empty secret to exercise the open-when-unconfigured
// branch. From test/middleware/ this path resolves to the repo's config/config,
// unlike setup.ts whose shallower path resolves outside the repo (a no-op).
vi.mock('../../config/config', () => ({ ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET: '' }));

// eslint-disable-next-line import/first
import { alchemySponsorshipWebhookAuth } from '../../src/middleware/alchemy-sponsorship-webhook';

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('alchemySponsorshipWebhookAuth (no secret configured)', () => {
  it('passes through when no shared secret is configured', () => {
    const req: any = { params: {}, url: '/verify', originalUrl: '/verify' };
    const res = mockRes();
    const next = vi.fn();
    alchemySponsorshipWebhookAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('passes through but still redacts a stray secret segment (config drift)', () => {
    // Under config drift the path value may be a live secret, so it must be
    // redacted from the URL even though it is not enforced in open mode.
    const req: any = {
      params: { secret: 'whatever' },
      url: '/verify/whatever',
      originalUrl: '/verify/whatever',
    };
    const res = mockRes();
    const next = vi.fn();
    alchemySponsorshipWebhookAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
    expect(req.originalUrl).toBe('/verify/[REDACTED]');
  });
});
