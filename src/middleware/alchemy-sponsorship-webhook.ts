import { Request, Response, NextFunction } from 'express';

import { ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET } from '../../config/config';

import { constantTimeEqual } from '../util/misc';

// Guards the Alchemy Gas Manager custom-rules webhook. Alchemy lets us configure
// only a URL (no auth header, no signature), so the shared secret is carried in
// the URL path (:secret) and compared in constant time here.
export function alchemySponsorshipWebhookAuth(req: Request, res: Response, next: NextFunction) {
  const { secret } = req.params as Record<string, string>;
  if (secret) {
    // The shared secret rides in the URL path; strip every occurrence from
    // req.url/originalUrl (and thus req.path) so error logging never records it.
    // req.params.secret is URL-decoded, so also redact the encoded form in case
    // the secret contains reserved characters.
    const encodedSecret = encodeURIComponent(secret);
    const redact = (s: string) => s.split(secret).join('[REDACTED]')
      .split(encodedSecret).join('[REDACTED]');
    req.url = redact(req.url);
    req.originalUrl = redact(req.originalUrl);
  }
  // Fail closed: Alchemy treats any non-200 as a failure and falls back to
  // approveOnFailure (fail-open), so a missing/unconfigured secret must still
  // answer 200 { approved: false } rather than 401/500.
  if (!ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET
    || !secret
    || !constantTimeEqual(secret, ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET)) {
    res.status(200).json({ approved: false });
    return;
  }
  next();
}

export default alchemySponsorshipWebhookAuth;
