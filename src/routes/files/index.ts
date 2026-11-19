import { Router } from 'express';
import { z } from 'zod';
import { getArweaveTxInfo } from '../../util/api/arweave/tx';
import { serveTierFile, toContentError } from '../../util/api/arweave/serve';
import { isEbookTierBucketEnabled } from '../../util/gcloudStorage';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

// Same alphabet as stagedObjectPath, so an id never addresses a nested Firestore path.
const FileIdParamsSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

// Public, unauthenticated: only an open-tier doc that finished uploading is served.
// A protected doc answers 404, never 403, so its existence is not confirmed.
router.get(
  '/:id',
  async (req, res, next) => {
    try {
      // An id that cannot exist is "not found", not a 400 from validateParams.
      const parsed = FileIdParamsSchema.safeParse(req.params);
      if (!parsed.success) throw new ValidationError('FILE_NOT_FOUND', 404);
      const { id } = parsed.data;
      const tx = await getArweaveTxInfo(id);
      // The tier must be stated: a missing one defaults to protected elsewhere,
      // and a protected object must never get a public immutable cache header.
      const tier = 'open';
      if (
        !tx
        || tx.status !== 'complete'
        || tx.isRequireAuth !== false
        || tx.tier !== tier
        || !tx.contentBucketPath
        || !isEbookTierBucketEnabled(tier)
      ) {
        throw new ValidationError('FILE_NOT_FOUND', 404);
      }
      // A cached response must not carry the credentialed origin the global cors
      // middleware reflected, so drop it and answer with a wildcard instead.
      res.removeHeader('Access-Control-Allow-Credentials');
      await serveTierFile(req, res, next, {
        tier,
        objectPath: tx.contentBucketPath,
        contentType: tx.contentType,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      next(toContentError(error));
    }
  },
);

export default router;
