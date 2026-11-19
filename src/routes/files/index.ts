import { Router } from 'express';
import { z } from 'zod';
import { getArweaveTxInfo } from '../../util/api/arweave/tx';
import { serveTierFile, toContentError } from '../../util/api/arweave/serve';
import { isEbookTierBucketEnabled } from '../../util/gcloudStorage';
import { validateParams } from '../../middleware/validate';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

const FileIdParamsSchema = z.object({ id: z.string().min(1) });

// Public, unauthenticated: only an open-tier doc that finished uploading is served.
// A protected doc answers 404, never 403, so its existence is not confirmed.
router.get(
  '/:id',
  validateParams(FileIdParamsSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as Record<string, string>;
      const tx = await getArweaveTxInfo(id);
      const tier = tx?.tier || 'protected';
      if (
        !tx
        || tx.status !== 'complete'
        || tx.isRequireAuth !== false
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
