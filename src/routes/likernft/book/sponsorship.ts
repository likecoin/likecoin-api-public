import { Router, Request } from 'express';

import { alchemySponsorshipWebhookAuth } from '../../../middleware/alchemy-sponsorship-webhook';
import { validateBody } from '../../../middleware/validate';
import { evaluateSponsorship, VerifySchema } from '../../../util/api/likernft/book/sponsorship';
import publisher from '../../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../constant';

const router = Router();

// The auth middleware already redacted the shared secret from req.originalUrl,
// so these fields are safe to log.
const buildLoggedReq = (req: Request) => ({
  headers: req.headers,
  ip: req.ip,
  auth: (req as any).auth,
  originalUrl: req.originalUrl,
});

// Alchemy Gas Manager custom-rules webhook. Alchemy POSTs a userOperation and
// expects HTTP 200 { approved: boolean }. The decision must always be expressed
// as a 200 body — a non-200 is treated by Alchemy as a failure and falls through
// to approveOnFailure. The :secret path segment authenticates the caller, and is
// optional: when no secret is configured the bare /verify URL is accepted.
router.post(
  '/verify{/:secret}',
  alchemySponsorshipWebhookAuth,
  validateBody(VerifySchema),
  async (req, res) => {
    try {
      const decision = await evaluateSponsorship(req.body);
      if (!decision.approved) {
        publisher.publish(PUBSUB_TOPIC_MISC, buildLoggedReq(req), {
          logType: 'SponsorshipRejected',
          reason: decision.reason,
          sender: req.body?.userOperation?.sender,
          policyId: req.body?.policyId,
          chainId: req.body?.chainId,
        });
      }
      res.json({ approved: decision.approved });
    } catch (err) {
      // Fail closed: a runtime error (e.g. Firestore) must not propagate to the
      // global error handler and return non-200, which Alchemy treats as a
      // failure and may approveOnFailure (fail-open). Log and deny instead.
      publisher.publish(PUBSUB_TOPIC_MISC, buildLoggedReq(req), {
        logType: 'SponsorshipVerifyError',
        error: (err as Error)?.message || String(err),
        sender: req.body?.userOperation?.sender,
        policyId: req.body?.policyId,
        chainId: req.body?.chainId,
      });
      res.status(200).json({ approved: false });
    }
  },
);

export default router;
