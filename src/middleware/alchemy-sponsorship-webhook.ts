import { Request, Response, NextFunction } from 'express';

import { ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET } from '../../config/config';

import { constantTimeEqual } from '../util/misc';

// Guards the Alchemy Gas Manager custom-rules webhook. Alchemy lets us configure
// only a URL (no auth header, no signature), so the shared secret is carried in
// the URL path (:secret) and compared in constant time here.
export function alchemySponsorshipWebhookAuth(req: Request, res: Response, next: NextFunction) {
  const { secret } = req.params as Record<string, string>;
  if (secret) {
    // Strip the path secret from req.url/originalUrl before any return so it never
    // reaches logs — even under config drift (secret sent while env var is unset).
    // params.secret is URL-decoded, so redact the encoded form too.
    const encodedSecret = encodeURIComponent(secret);
    const redact = (s: string) => s.split(secret).join('[REDACTED]')
      .split(encodedSecret).join('[REDACTED]');
    req.url = redact(req.url);
    req.originalUrl = redact(req.originalUrl);
  }
  // When no shared secret is configured, leave the webhook open: it only reveals
  // whether an EVM address is a registered likerId user, which is already public
  // via the /addr/min endpoint. The secret is opt-in hardening, not confidentiality.
  if (!ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET) {
    next();
    return;
  }
  // A secret is configured: require a constant-time match. Fail closed — Alchemy
  // treats any non-200 as a failure and falls back to approveOnFailure (fail-open),
  // so a missing/wrong secret must still answer 200 { approved: false }, not 401/500.
  if (!secret || !constantTimeEqual(secret, ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET)) {
    res.status(200).json({ approved: false });
    return;
  }
  next();
}

export default alchemySponsorshipWebhookAuth;
